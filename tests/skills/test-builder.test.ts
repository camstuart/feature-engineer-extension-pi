/**
 * Runner-level tests for the Test Builder's deterministic red-phase gate.
 *
 * These exercise `runTestBuilder` end-to-end against real shell commands
 * (via `qa.ts`'s `checkRedPhase`), with `ctx.newSession` faked to invoke
 * `withSession` synchronously instead of spinning up a real Pi session —
 * the same faking style used for `startSkillSession` in `tests/runner.test.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTestBuilder } from "@/skills/test-builder";
import { configFileDiskName, featureDirPath, artifactFileDiskName } from "@/paths";
import { configureRateLimit, DEFAULT_CONFIG } from "@/rate-limit";
import type { FeatureState } from "@/state";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

beforeEach(() => {
  configureRateLimit({ ...DEFAULT_CONFIG, postResetBufferMs: 0, pollIntervalMs: 50 });
});

let cwd: string;

const STATE: FeatureState = {
  featureId: 1,
  featureSlug: "foo",
  featureDir: "/unused",
  step: "test-builder",
};

/** Marker file whose presence flips the fake test command from "pass" (violation) to "fail" (correct red phase). */
function markerPath(dir: string): string {
  return join(dir, "tests-should-fail");
}

function writeInputs(cwd: string): void {
  const feBase = join(cwd, ".feature-engineer");
  mkdirSync(feBase, { recursive: true });
  writeFileSync(join(feBase, configFileDiskName("structure")), "structure content");
  writeFileSync(join(feBase, configFileDiskName("tech-stack")), "tech stack content");
  // The test command exits 1 (fail) once the marker file exists, 0 (pass)
  // otherwise. The typecheck command always passes in these tests.
  const testCmd = `test -f ${markerPath(cwd)} && exit 1 || exit 0`;
  writeFileSync(
    join(feBase, configFileDiskName("qa-static-tools")),
    `# QA Static Tools\n\n## Test Runner\nCommand: \`${testCmd}\`\n\n## Type Checker\nCommand: \`true\`\n`,
  );

  const featDir = featureDirPath(cwd, STATE.featureId, STATE.featureSlug);
  mkdirSync(featDir, { recursive: true });
  writeFileSync(join(featDir, artifactFileDiskName("technical-architecture")!), "architecture content");
  writeFileSync(join(featDir, artifactFileDiskName("technical-plan-testing")!), "test plan content");
  writeFileSync(
    join(featDir, artifactFileDiskName("technical-plan-implementation")!),
    "impl plan content",
  );
}

/**
 * Builds a fake `ExtensionCommandContext` whose `newSession` immediately
 * invokes the `withSession` callback with a minimal fake session context,
 * without any real Pi session machinery. `onTurn` runs once per simulated
 * LLM turn (i.e. once per attempt) — tests use it to mutate the fixture
 * (e.g. drop the marker file) between attempts.
 */
function makeFakeCtx(onTurn: () => void): { ctx: ExtensionCommandContext; calls: string[] } {
  const calls: string[] = [];
  const ctx = {
    cwd,
    hasUI: true,
    ui: {
      notify: (message: string, level: string) => {
        calls.push(`notify:${level}:${message}`);
      },
      setStatus: () => {},
    },
    sessionManager: {
      getSessionFile: () => "/fake/session.jsonl",
    },
    signal: undefined,
    newSession: async (options: {
      setup?: (sm: unknown) => Promise<void>;
      withSession: (c: unknown) => Promise<void>;
    }) => {
      if (options.setup) {
        await options.setup({
          appendCustomEntry: () => {},
          appendSessionInfo: () => {},
        });
      }
      onTurn();
      const fakeNewCtx = {
        ui: ctx.ui,
        sendUserMessage: async () => {},
        waitForIdle: async () => {},
        // `runCompaction` (runner.ts) awaits a promise resolved via
        // `onComplete`, so the fake must invoke it synchronously — a
        // no-op `compact` would hang `startSkillSession` forever.
        compact: (o: { onComplete?: (r: unknown) => void }) => {
          o.onComplete?.({});
        },
        cwd,
        sessionManager: { appendCustomEntry: () => {} },
      };
      await options.withSession(fakeNewCtx);
      return { cancelled: false };
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, calls };
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "fe-test-builder-"));
  writeInputs(cwd);
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("skills/test-builder — red-phase gate", () => {
  it("advances immediately when the red-phase invariant holds on attempt 1", async () => {
    writeFileSync(markerPath(cwd), ""); // test command will exit 1 (fail) — correct red phase
    let completed = false;
    let turns = 0;

    const { ctx } = makeFakeCtx(() => {
      turns += 1;
    });

    const result = await runTestBuilder(ctx, STATE, {
      onComplete: async () => {
        completed = true;
      },
    });

    expect(result.cancelled).toBe(false);
    expect(completed).toBe(true);
    expect(turns).toBe(1);
  });

  it("retries once on a violation, then advances once the retry attempt is clean", async () => {
    // No marker initially: test command exits 0 (pass) — a violation
    // ("tests-passed"). The second simulated turn drops the marker so the
    // retry attempt is clean.
    let completed = false;
    let turns = 0;

    const { ctx, calls } = makeFakeCtx(() => {
      turns += 1;
      if (turns === 2) {
        writeFileSync(markerPath(cwd), "");
      }
    });

    const result = await runTestBuilder(ctx, STATE, {
      onComplete: async () => {
        completed = true;
      },
    });

    expect(result.cancelled).toBe(false);
    expect(completed).toBe(true);
    expect(turns).toBe(2);
    expect(calls.some((c) => c.includes("retry 2/2"))).toBe(true);
  });

  it("pauses without advancing when the violation persists through the retry budget", async () => {
    // Marker never created: test command always exits 0 (pass) — the
    // violation never clears.
    let completed = false;
    let turns = 0;

    const { ctx, calls } = makeFakeCtx(() => {
      turns += 1;
    });

    const result = await runTestBuilder(ctx, STATE, {
      onComplete: async () => {
        completed = true;
      },
    });

    expect(result.cancelled).toBe(false);
    expect(completed).toBe(false);
    expect(turns).toBe(2);
    expect(calls.some((c) => c.includes("notify:error") && c.includes("paused"))).toBe(true);
  });
});
