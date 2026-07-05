/**
 * Tests for the runner's intermediate-steps mechanism. The runner is glue
 * code that orchestrates pi's session APIs, so the tests use lightweight
 * fakes rather than the real runtime.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { configureRateLimit, DEFAULT_CONFIG } from "@/rate-limit";
import {
  driveIntermediateSteps,
  startSkillSession,
  type SkillSessionContext,
} from "@/skills/runner";

/**
 * Disable the post-reset buffer in runner tests so the retry loop
 * doesn't wait the default 60s buffer between attempts. Each test
 * should be deterministic about the rate-limit config.
 */
beforeEach(() => {
  configureRateLimit({ ...DEFAULT_CONFIG, postResetBufferMs: 0, pollIntervalMs: 50 });
});

interface CallRecord {
  method: string;
  args: unknown[];
}

function makeFakeCtx(): SkillSessionContext & { calls: CallRecord[] } {
  const calls: CallRecord[] = [];
  const appendedEntries: Array<{ customType: string; data: unknown }> = [];
  // The runner casts `newCtx.sessionManager` to a writable SessionManager
  // and calls `appendCustomEntry` on it. The fake mirrors this: a session
  // manager with `appendCustomEntry` that delegates to the same recorder
  // the SkillSessionContext-side `appendCustomEntry` uses.
  const sessionManager = {
    appendCustomEntry(customType: string, data?: unknown) {
      calls.push({ method: "sessionManager.appendCustomEntry", args: [customType, data] });
      appendedEntries.push({ customType, data });
    },
  };
  const ctx = {
    calls,
    appendedEntries,
    sessionManager,
    ui: {
      notify(message: string, level: "info" | "warning" | "error") {
        calls.push({ method: "ui.notify", args: [message, level] });
      },
    },
    sendUserMessage(content: string) {
      calls.push({ method: "sendUserMessage", args: [content] });
      return Promise.resolve();
    },
    waitForIdle() {
      calls.push({ method: "waitForIdle", args: [] });
      return Promise.resolve();
    },
    compact(options: { onComplete?: (r: never) => void }) {
      calls.push({ method: "compact", args: [options] });
      // Simulate immediate success
      Promise.resolve().then(() => options.onComplete?.({} as never));
    },
    cwd: "/fake/cwd",
    appendCustomEntry(customType: string, data?: unknown) {
      calls.push({ method: "appendCustomEntry", args: [customType, data] });
      appendedEntries.push({ customType, data });
    },
  };
  return ctx;
}

describe("runner", () => {
  describe("driveIntermediateSteps", () => {
    it("sends each step's prompt in order", async () => {
      const ctx = makeFakeCtx();
      await driveIntermediateSteps(ctx, [
        { prompt: "step 1" },
        { prompt: "step 2" },
        { prompt: "step 3" },
      ]);

      const prompts = ctx.calls
        .filter((c) => c.method === "sendUserMessage")
        .map((c) => c.args[0]);
      expect(prompts).toEqual(["step 1", "step 2", "step 3"]);
    });

    it("waits for idle after each step's sendUserMessage", async () => {
      const ctx = makeFakeCtx();
      await driveIntermediateSteps(ctx, [{ prompt: "x" }, { prompt: "y" }]);

      const callOrder = ctx.calls.map((c) => c.method);
      // Expected: sendUserMessage(x), waitForIdle, sendUserMessage(y), waitForIdle
      expect(callOrder).toEqual([
        "sendUserMessage",
        "waitForIdle",
        "sendUserMessage",
        "waitForIdle",
      ]);
    });

    it("compacts between steps with the CURRENT step's instructions", async () => {
      // The compactInstructions are attached to the step that just
      // completed — they describe what to preserve going INTO the next step.
      const ctx = makeFakeCtx();
      await driveIntermediateSteps(ctx, [
        { prompt: "first", compactInstructions: "summarise A" },
        { prompt: "second", compactInstructions: "summarise B" },
      ]);

      const compactions = ctx.calls.filter((c) => c.method === "compact");
      expect(compactions).toHaveLength(1);
      // Only step 0 ("first") triggers a compaction (between step 0 and
      // step 1). Step 1 ("second") is the last and triggers nothing.
      const opts = compactions[0]?.args[0] as { customInstructions: string };
      expect(opts.customInstructions).toBe("summarise A");
    });

    it("does NOT compact after the last step", async () => {
      const ctx = makeFakeCtx();
      await driveIntermediateSteps(ctx, [
        { prompt: "first", compactInstructions: "x" },
        { prompt: "second", compactInstructions: "y" }, // last
      ]);

      const compactions = ctx.calls.filter((c) => c.method === "compact");
      expect(compactions).toHaveLength(1);
      // The single compaction should be from "first" (before "second"),
      // not from "second" (which is last).
      const opts = compactions[0]?.args[0] as { customInstructions: string };
      expect(opts.customInstructions).toBe("x");
    });

    it("skips compaction when compactInstructions is undefined", async () => {
      const ctx = makeFakeCtx();
      await driveIntermediateSteps(ctx, [
        { prompt: "first" }, // no compactInstructions
        { prompt: "second" },
      ]);

      const compactions = ctx.calls.filter((c) => c.method === "compact");
      expect(compactions).toHaveLength(0);
    });

    it("resolves a lazy (function) prompt at send time, reflecting mutations made by an earlier step", async () => {
      // Simulates the review-loop use case: a later step's prompt must read
      // fresh state written by an earlier step's LLM turn, not a snapshot
      // captured when the `steps` array was built.
      let counter = 0;
      const ctx = makeFakeCtx();
      // Mutate `counter` as a side effect of the fake's sendUserMessage,
      // standing in for "pass 1 appended concerns to the concerns file".
      const originalSend = ctx.sendUserMessage.bind(ctx);
      ctx.sendUserMessage = (content: string) => {
        if (content === "step 1") {
          counter += 1;
        }
        return originalSend(content);
      };

      await driveIntermediateSteps(ctx, [
        { prompt: "step 1" },
        { prompt: () => `value is ${counter}` },
      ]);

      const prompts = ctx.calls
        .filter((c) => c.method === "sendUserMessage")
        .map((c) => c.args[0]);
      // The steps array was built with counter === 0, but step 2's prompt
      // function is only invoked immediately before it's sent — by which
      // point step 1 has already run and incremented counter to 1.
      expect(prompts).toEqual(["step 1", "value is 1"]);
    });

    it("sends plain string prompts unchanged when mixed with lazy prompts", async () => {
      const ctx = makeFakeCtx();
      await driveIntermediateSteps(ctx, [
        { prompt: "plain string one" },
        { prompt: () => "resolved from function" },
        { prompt: "plain string two" },
      ]);

      const prompts = ctx.calls
        .filter((c) => c.method === "sendUserMessage")
        .map((c) => c.args[0]);
      expect(prompts).toEqual([
        "plain string one",
        "resolved from function",
        "plain string two",
      ]);
    });

    it("resolves even if compaction errors (onError resolves)", async () => {
      const ctx = makeFakeCtx();
      // Replace compact to call onError instead of onComplete.
      ctx.compact = (options) => {
        ctx.calls.push({ method: "compact", args: [options] });
        Promise.resolve().then(() => options.onError?.(new Error("boom")));
      };

      await expect(
        driveIntermediateSteps(ctx, [
          { prompt: "first", compactInstructions: "x" },
          { prompt: "second" },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe("startSkillSession", () => {
    /**
     * Captures `setup` and `withSession` callbacks passed to
     * `ctx.newSession(...)` into the supplied holders, instead of
     * creating a real session. Test bodies invoke the captured
     * callbacks directly to inspect / drive them.
     */
    function captureInto(
      capturedSetupRef: { value: ((sm: unknown) => Promise<void>) | null },
      capturedWithSessionRef: { value: ((c: unknown) => Promise<void>) | null },
    ) {
      return (options: {
        parentSession?: string;
        setup?: (sm: unknown) => Promise<void>;
        withSession?: (c: unknown) => Promise<void>;
      }) => {
        capturedSetupRef.value = options.setup ?? null;
        capturedWithSessionRef.value = options.withSession ?? null;
        return Promise.resolve({ cancelled: false });
      };
    }

    it("calls setup with a SessionManager that receives the fe-state entry and the session name", async () => {
      const capturedSetup: { value: ((sm: unknown) => Promise<void>) | null } = { value: null };
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };

      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        newSession: captureInto(capturedSetup, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      const state = {
        featureId: 3,
        featureSlug: "user-auth",
        featureDir: "/fake/features/003-user-auth",
        step: "req-gathering" as const,
      };

      await startSkillSession(ctx, state, "the prompt");

      expect(capturedSetup.value).not.toBeNull();

      // Invoke setup against a fake SessionManager and verify it
      // appends BOTH the workflow state AND the session name.
      const smCalls: string[] = [];
      const fakeSm = {
        appendCustomEntry: (customType: string) => {
          smCalls.push(`appendCustomEntry:${customType}`);
        },
        appendSessionInfo: (name: string) => {
          smCalls.push(`appendSessionInfo:${name}`);
        },
      };

      await capturedSetup.value!(fakeSm);

      expect(smCalls).toHaveLength(2);
      expect(smCalls[0]).toBe("appendCustomEntry:fe-state");
      expect(smCalls[1]).toMatch(/^appendSessionInfo:FE \d+\.\d+\.\d+ \[user-auth\] — Requirement gathering$/);
    });

    it("does NOT throw a stale-ctx error from withSession (regression test)", async () => {
      // Regression: the runner used to call `pi.setSessionName(...)`
      // inside `withSession`, which throws because the captured `pi`
      // is stale after `ctx.newSession()`. Verify the runner no longer
      // requires `pi` at all — if the runner still touched a captured
      // `pi` after `ctx.newSession()`, this test would break because
      // the runner signature has dropped the `pi` parameter.
      const capturedSetup: { value: ((sm: unknown) => Promise<void>) | null } = { value: null };
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };

      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        newSession: captureInto(capturedSetup, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "req-gathering" as const,
      };

      await startSkillSession(ctx, state, "prompt");

      // Invoke withSession against a fake newCtx and verify it
      // completes without ever touching any captured extension-level
      // state. It should send the initial prompt and stop.
      const newCtx = makeFakeCtx();
      await expect(capturedWithSession.value!(newCtx)).resolves.toBeUndefined();

      const sends = newCtx.calls.filter((c) => c.method === "sendUserMessage");
      expect(sends).toHaveLength(1);
      expect(sends[0]?.args[0]).toBe("prompt");
    });

    it("awaits the rate-limit gate BEFORE calling ctx.newSession()", async () => {
      // Regression: the rate-limit gate must run before the new
      // session is created, otherwise we'd burn rate-limit budget
      // by sending a request that the gate was about to defer.
      const capturedSetup: { value: ((sm: unknown) => Promise<void>) | null } = { value: null };
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };

      const order: string[] = [];

      const fakeUi = {
        setStatus: (_key: string, _text: string | undefined) => {
          order.push("gate:setStatus");
        },
        notify: (_m: string, _l: "info" | "warning" | "error") => {
          order.push("gate:notify");
        },
      };

      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        ui: fakeUi,
        signal: undefined,
        newSession: captureInto(capturedSetup, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      // Wrap newSession to record when it is called.
      const originalNewSession = ctx.newSession;
      (ctx as unknown as { newSession: (...args: unknown[]) => unknown }).newSession = (options: unknown) => {
        order.push("newSession");
        return originalNewSession(options as Parameters<typeof originalNewSession>[0]);
      };

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "req-gathering" as const,
      };

      // With no snapshot recorded, the gate is a no-op — no notify,
      // no setStatus. The order should still be: gate runs (no-op),
      // then newSession.
      await startSkillSession(ctx, state, "prompt");

      // No UI calls expected (gate was a no-op), so the first
      // recorded entry should be "newSession".
      expect(order[0]).toBe("newSession");
      // And the gate's setup callback should still have been captured.
      expect(capturedSetup.value).not.toBeNull();
    });

    it("retries the stage on a 429-induced abort, then succeeds", async () => {
      // Regression: when the 429 handler in rate-limit.ts sets
      // lastAttemptWasThrottled and the in-flight LLM call aborts,
      // ctx.newSession throws. The runner must catch that, poll, and
      // re-run the stage with a fresh session.
      const { recordProviderResponse } = await import("@/rate-limit");
      const { resetAttemptThrottledFlag } = await import("@/rate-limit");

      let attempt = 0;
      const order: string[] = [];
      const capturedSetups: Array<(sm: unknown) => Promise<void>> = [];
      const capturedWithSessions: Array<(c: unknown) => Promise<void>> = [];

      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        ui: {
          notify: (_m: string, _l: "info" | "warning" | "error") => {},
          setStatus: (_k: string, _t: string | undefined) => {},
        },
        signal: undefined,
        newSession: (options: {
          setup?: (sm: unknown) => Promise<void>;
          withSession?: (c: unknown) => Promise<void>;
        }) => {
          attempt += 1;
          order.push(`newSession:${attempt}`);
          if (options.setup) capturedSetups.push(options.setup);
          if (options.withSession) capturedWithSessions.push(options.withSession);

          if (attempt === 1) {
            // First attempt: simulate a 429 by setting the flag and
            // throwing. The runner should catch this and retry.
            recordProviderResponse(
              { status: 429, headers: { "retry-after": "1" } },
              "minimax",
              "m3",
            );
            return Promise.reject(new Error("Aborted: rate limit"));
          }
          // Second attempt: succeed.
          return Promise.resolve({ cancelled: false });
        },
      } as unknown as Parameters<typeof startSkillSession>[0];

      // Ensure no leftover state from other tests.
      resetAttemptThrottledFlag();

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "req-gathering" as const,
      };

      const result = await startSkillSession(ctx, state, "prompt");
      expect(result.cancelled).toBe(false);
      // Two newSession calls: one failed (attempt 1), one succeeded (attempt 2).
      expect(order).toEqual(["newSession:1", "newSession:2"]);
      // Each attempt captured its own setup + withSession.
      expect(capturedSetups).toHaveLength(2);
      expect(capturedWithSessions).toHaveLength(2);
    });

    it("gives up after maxAttempts rate-limited attempts", async () => {
      // All attempts hit 429. After maxAttempts (3) the runner
      // should surface the last error to the orchestrator.
      const { recordProviderResponse } = await import("@/rate-limit");
      const { resetAttemptThrottledFlag } = await import("@/rate-limit");

      let attempt = 0;
      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        ui: {
          notify: (_m: string, _l: "info" | "warning" | "error") => {},
          setStatus: (_k: string, _t: string | undefined) => {},
        },
        signal: undefined,
        newSession: (_options: {
          setup?: (sm: unknown) => Promise<void>;
          withSession?: (c: unknown) => Promise<void>;
        }) => {
          attempt += 1;
          recordProviderResponse(
            { status: 429, headers: { "retry-after": "1" } },
            "minimax",
            "m3",
          );
          return Promise.reject(new Error("Aborted: rate limit"));
        },
      } as unknown as Parameters<typeof startSkillSession>[0];

      resetAttemptThrottledFlag();

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "req-gathering" as const,
      };

      await expect(
        startSkillSession(ctx, state, "prompt", { maxAttempts: 3 }),
      ).rejects.toThrow();
      // Exactly maxAttempts (3) attempts.
      expect(attempt).toBe(3);
    });

    it("does NOT retry when the error is not rate-limit (e.g. real LLM error)", async () => {
      // A non-429 error should propagate immediately — only the
      // per-attempt throttled flag triggers retry.
      let attempt = 0;
      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        ui: {
          notify: (_m: string, _l: "info" | "warning" | "error") => {},
          setStatus: (_k: string, _t: string | undefined) => {},
        },
        signal: undefined,
        newSession: () => {
          attempt += 1;
          return Promise.reject(new Error("Some other LLM error"));
        },
      } as unknown as Parameters<typeof startSkillSession>[0];

      const { resetAttemptThrottledFlag } = await import("@/rate-limit");
      resetAttemptThrottledFlag();

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "req-gathering" as const,
      };

      await expect(
        startSkillSession(ctx, state, "prompt"),
      ).rejects.toThrow("Some other LLM error");
      // No retry: exactly one attempt.
      expect(attempt).toBe(1);
    });

    it("maxAttempts=1 disables the retry (single attempt only)", async () => {
      // Useful for tests that want to observe a single-shot failure.
      const { recordProviderResponse } = await import("@/rate-limit");
      const { resetAttemptThrottledFlag } = await import("@/rate-limit");

      let attempt = 0;
      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        ui: {
          notify: (_m: string, _l: "info" | "warning" | "error") => {},
          setStatus: (_k: string, _t: string | undefined) => {},
        },
        signal: undefined,
        newSession: () => {
          attempt += 1;
          recordProviderResponse(
            { status: 429, headers: { "retry-after": "1" } },
            "minimax",
            "m3",
          );
          return Promise.reject(new Error("Aborted: rate limit"));
        },
      } as unknown as Parameters<typeof startSkillSession>[0];

      resetAttemptThrottledFlag();

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "req-gathering" as const,
      };

      await expect(
        startSkillSession(ctx, state, "prompt", { maxAttempts: 1 }),
      ).rejects.toThrow();
      expect(attempt).toBe(1);
    });

    it("runs finalCompactInstructions AFTER the LLM's turn in single-shot mode", async () => {
      // Single-shot automated skill: no intermediateSteps. After the LLM
      // ends its turn, the runner should waitForIdle and then run the
      // final compaction before afterSend.
      const capturedSetup: { value: ((sm: unknown) => Promise<void>) | null } = { value: null };
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };

      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        newSession: captureInto(capturedSetup, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "test-builder" as const,
      };

      const finalCompactInstructions = "Summarise: test-builder done.";
      let afterSendRan = false;
      let afterSendCompactSeen = false;
      const newCtx = makeFakeCtx();

      await startSkillSession(ctx, state, "the prompt", {
        finalCompactInstructions,
        afterSend: async (_sCtx) => {
          afterSendRan = true;
          // Verify the compact has already run by the time afterSend fires.
          // `newCtx` (held in the closure) is the same object the runner
          // passes through as the SkillSessionContext; we read `.calls`
          // from it directly since the runner now wraps it in a fresh
          // object for SkillSessionContext conformance.
          afterSendCompactSeen = newCtx.calls.some(
            (c) => c.method === "compact",
          );
        },
      });

      const newCtx2 = newCtx;
      await capturedWithSession.value!(newCtx2);

      expect(afterSendRan).toBe(true);
      expect(afterSendCompactSeen).toBe(true);
      const compactions = newCtx2.calls.filter((c) => c.method === "compact");
      expect(compactions).toHaveLength(1);
      const opts = compactions[0]?.args[0] as { customInstructions: string };
      expect(opts.customInstructions).toBe(finalCompactInstructions);

      // The order must be: sendUserMessage, waitForIdle, compact, afterSend.
      const callMethods = newCtx2.calls.map((c) => c.method);
      const sendIdx = callMethods.indexOf("sendUserMessage");
      const waitIdx = callMethods.indexOf("waitForIdle");
      const compactIdx = callMethods.indexOf("compact");
      expect(sendIdx).toBeLessThan(waitIdx);
      expect(waitIdx).toBeLessThan(compactIdx);
    });

    it("runs finalCompactInstructions AFTER the last intermediate step", async () => {
      // Multi-step skill (e.g. review-completion): the final compaction
      // fires AFTER the last intermediate step, not between every step.
      const capturedSetup: { value: ((sm: unknown) => Promise<void>) | null } = { value: null };
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };

      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        newSession: captureInto(capturedSetup, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "review-completion" as const,
      };

      const finalCompactInstructions = "Summarise: review complete.";

      await startSkillSession(ctx, state, "the prompt", {
        intermediateSteps: [
          { prompt: "step 1", compactInstructions: "between 1 and 2" },
          { prompt: "step 2", compactInstructions: "between 2 and 3" },
          { prompt: "step 3" }, // last
        ],
        finalCompactInstructions,
      });

      const newCtx = makeFakeCtx();
      await capturedWithSession.value!(newCtx);

      const compactions = newCtx.calls.filter((c) => c.method === "compact");
      // 2 inter-step compactions (between step 1 and 2, between step 2 and 3)
      // + 1 final compaction (after step 3) = 3 total.
      expect(compactions).toHaveLength(3);
      const opts = compactions.map(
        (c) => (c.args[0] as { customInstructions: string }).customInstructions,
      );
      expect(opts[0]).toBe("between 1 and 2");
      expect(opts[1]).toBe("between 2 and 3");
      expect(opts[2]).toBe(finalCompactInstructions);
    });

    it("does NOT run finalCompactInstructions when not set", async () => {
      // Backward-compat: skills that don't set finalCompactInstructions
      // should behave as before — no final compaction.
      const capturedSetup: { value: ((sm: unknown) => Promise<void>) | null } = { value: null };
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };

      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: {
          getSessionFile: () => "/fake/session.jsonl",
        },
        newSession: captureInto(capturedSetup, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "test-builder" as const,
      };

      await startSkillSession(ctx, state, "the prompt");

      const newCtx = makeFakeCtx();
      await capturedWithSession.value!(newCtx);

      const compactions = newCtx.calls.filter((c) => c.method === "compact");
      expect(compactions).toHaveLength(0);
    });

    it("calls onLlmTurnEnd AFTER the LLM turn and AFTER final compaction in single-shot mode", async () => {
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };
      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: { getSessionFile: () => "/fake/session.jsonl" },
        newSession: captureInto({ value: null }, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "test-builder" as const,
      };

      let hookRan = false;
      let hookAfterCompact = false;

      await startSkillSession(ctx, state, "the prompt", {
        finalCompactInstructions: "summarise",
        onLlmTurnEnd: async (sCtx) => {
          hookRan = true;
          // Verify the sCtx exposes cwd + appendCustomEntry.
          expect(sCtx.cwd).toBe("/fake/cwd");
          sCtx.appendCustomEntry("test-entry", { hello: "world" });
          // And the compact should have run by the time we get here.
          hookAfterCompact = (newCtx.calls.some((c) => c.method === "compact"));
        },
      });

      const newCtx = makeFakeCtx();
      await capturedWithSession.value!(newCtx);

      expect(hookRan).toBe(true);
      expect(hookAfterCompact).toBe(true);
      const appended = (newCtx as unknown as { appendedEntries: Array<{ customType: string; data: unknown }> }).appendedEntries.find((e) => e.customType === "test-entry");
      expect(appended?.data).toEqual({ hello: "world" });

      // Order: sendUserMessage → waitForIdle → compact → appendCustomEntry
      // (the fake records appendCustomEntry via the sessionManager path,
      // since that's where the runner's cast lands).
      const methods = newCtx.calls.map((c) => c.method);
      const sendIdx = methods.indexOf("sendUserMessage");
      const waitIdx = methods.indexOf("waitForIdle");
      const compactIdx = methods.indexOf("compact");
      const appendIdx = methods.indexOf("sessionManager.appendCustomEntry");
      expect(sendIdx).toBeLessThan(waitIdx);
      expect(waitIdx).toBeLessThan(compactIdx);
      expect(compactIdx).toBeLessThan(appendIdx);
    });

    it("calls onLlmTurnEnd AFTER the last intermediate step + final compaction", async () => {
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };
      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: { getSessionFile: () => "/fake/session.jsonl" },
        newSession: captureInto({ value: null }, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];

      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "review-completion" as const,
      };

      let hookRan = false;
      await startSkillSession(ctx, state, "the prompt", {
        intermediateSteps: [
          { prompt: "step 1", compactInstructions: "between 1-2" },
          { prompt: "step 2", compactInstructions: "between 2-3" },
          { prompt: "step 3" }, // last
        ],
        finalCompactInstructions: "summarise",
        onLlmTurnEnd: async () => {
          hookRan = true;
        },
      });

      const newCtx = makeFakeCtx();
      await capturedWithSession.value!(newCtx);

      expect(hookRan).toBe(true);
      // 2 inter-step compactions + 1 final = 3 compactions, hook runs after the final.
      const compactions = newCtx.calls.filter((c) => c.method === "compact");
      expect(compactions).toHaveLength(3);
      const methods = newCtx.calls.map((c) => c.method);
      const finalCompactIdx = methods.lastIndexOf("compact");
      // The hook fires after the last compact. Verify by checking that
      // there are no sendUserMessage calls after the final compact
      // (which would indicate another LLM turn starting).
      const lastSend = methods.lastIndexOf("sendUserMessage");
      expect(lastSend).toBeLessThan(finalCompactIdx);
    });

    it("does NOT call onLlmTurnEnd when it is not set", async () => {
      // Sanity check: omitting the hook must not break anything. We verify
      // by checking that no appendCustomEntry was called via the hook path.
      // (appendCustomEntry is only invoked from within onLlmTurnEnd.)
      const capturedWithSession: { value: ((c: unknown) => Promise<void>) | null } = { value: null };
      const ctx = {
        cwd: "/fake/cwd",
        sessionManager: { getSessionFile: () => "/fake/session.jsonl" },
        newSession: captureInto({ value: null }, capturedWithSession),
      } as unknown as Parameters<typeof startSkillSession>[0];
      const state = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/fake",
        step: "test-builder" as const,
      };
      await startSkillSession(ctx, state, "the prompt");
      const newCtx = makeFakeCtx();
      await capturedWithSession.value!(newCtx);
      expect(newCtx.calls.some((c) => c.method === "appendCustomEntry")).toBe(false);
    });
  });
});