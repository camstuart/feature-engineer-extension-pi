/**
 * Shared runner for skill sessions.
 *
 * Each skill orchestrates a fresh Pi session: persists the incoming state,
 * names the session, sends the skill prompt, and (for interactive skills)
 * leaves the user in the session to interact.
 *
 * The pure prompt builders live in `prompts/`. The pure state transitions
 * live in `persistence.ts` and `routing.ts`. This module is glue.
 */

import type { CompactOptions, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  gateIfNeeded,
  pollProviderUsage,
  resetAttemptThrottledFlag,
  wasLastAttemptThrottled,
} from "../rate-limit.js";
import { encodeState } from "../persistence.js";
import { stepDisplayName, type FeatureState } from "../state.js";
import { VERSION } from "../version.js";

/**
 * Maximum number of attempts per stage before giving up and
 * surfacing the failure to the orchestrator. Each attempt creates a
 * fresh session and pays the rate-limit gate's poll before
 * re-sending the prompt.
 */
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Structural type for the replacement-session context passed to `withSession`.
 *
 * We don't import `ReplacedSessionContext` directly because it isn't
 * re-exported from `@earendil-works/pi-coding-agent`'s index. Instead we
 * declare the subset of methods the runner needs — every method listed here
 * is present on the runtime context.
 */
export interface SkillSessionContext {
  ui: {
    notify(message: string, level: "info" | "warning" | "error"): void;
  };
  sendUserMessage(content: string): Promise<void>;
  waitForIdle(): Promise<void>;
  compact(options: CompactOptions): void;
  /** The new session's working directory. */
  cwd: string;
  /**
   * Append a custom entry to the new session's branch (not in LLM context).
   * Persists across Pi restarts; the latest entry per `customType` wins on
   * session reload.
   *
   * Used to surface state changes (e.g. Implementation Builder's `implFailed`
   * flag after QA exhaustion) to `latestState` on the next `session_start`.
   */
  appendCustomEntry(customType: string, data?: unknown): void;
}

/**
 * Public entry: starts a fresh Pi session for a skill.
 *
 * Behaviour:
 *  1. Persist `nextState` into the new session BEFORE the LLM runs so that
 *     `session_start` listeners (including ours) can pick it up.
 *  2. Name the session so the user knows where they are.
 *  3. Send the initial prompt.
 *  4. If `intermediateSteps` is provided, drive each step in turn: send the
 *     step's prompt, wait for the LLM to finish, then compact context with
 *     the step's `compactInstructions` before the next step. This makes
 *     inter-step compaction deterministic — the LLM is no longer trusted
 *     to call `ctx.compact` itself.
 *  5. If `finalCompactInstructions` is set, run that compaction AFTER the
 *     final LLM turn (last intermediate step, or initial prompt when no
 *     intermediate steps). This satisfies PRD §11 rule 6: "compact after
 *     each automated step's output is written, before the session
 *     transitions".
 *  6. After all steps (or after the initial prompt when there are no
 *     intermediate steps), run `afterSend` if provided. This is the place
 *     for automated skills to wait for the LLM and then auto-advance.
 *
 * For interactive skills, the orchestrator does NOT call `waitForIdle` —
 * the user needs to interact (review, edit, confirm) inside the session.
 */
export async function startSkillSession(
  ctx: ExtensionCommandContext,
  nextState: FeatureState,
  prompt: string,
  options: StartSkillSessionOptions = {},
): Promise<{ cancelled: boolean }> {
  const sessionName = `FE ${VERSION} [${nextState.featureSlug}] — ${stepDisplayName(nextState.step)}`;
  const parentSession = ctx.sessionManager.getSessionFile();

  // Build a gate AbortController for the rate-limit wait. We bridge
  // it to the caller's signal so Esc / Ctrl+C short-circuits the
  // poll, but use a fresh controller as a fallback because
  // `ctx.signal` is often undefined in command contexts.
  const makeGateController = (): AbortController => {
    const c = new AbortController();
    if (ctx.signal) {
      const onAbort = (): void => c.abort();
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      c.signal.addEventListener("abort", () => {
        ctx.signal?.removeEventListener("abort", onAbort);
      }, { once: true });
    }
    return c;
  };

  // First gate: check if we already know we're rate-limited from a
  // previous stage's response.
  await gateIfNeeded(ctx, makeGateController().signal);

  // Retry loop. Each attempt is a fresh `ctx.newSession` call. The
  // loop catches 429-induced aborts (via the per-attempt flag set by
  // the rate-limit listener) and re-runs the stage after polling.
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Reset the per-attempt throttled flag so the listener can set
    // it cleanly if THIS attempt hits a 429.
    resetAttemptThrottledFlag();

    // Proactively query the provider's usage endpoint (e.g. minimax's
    // `/v1/token_plan/remains`) for a fresh snapshot. This is what
    // makes the gate work for providers that don't expose any
    // rate-limit headers on 200 responses.
    await pollProviderUsage(ctx);

    // If this is a retry, run the rate-limit gate again. The 429
    // from the prior attempt will have refreshed the snapshot.
    if (attempt > 1) {
      const gateResult = await gateIfNeeded(ctx, makeGateController().signal);
      if (gateResult.aborted) {
        return { cancelled: true };
      }
    }

    try {
      return await ctx.newSession({
        parentSession,
        setup: async (sm) => {
          // Persist workflow state AND set the display name BEFORE
          // the LLM runs. `setup` runs against the new session's
          // SessionManager — touching the captured `pi` here would
          // throw the stale-ctx error documented in pi's
          // extensions guide.
          sm.appendCustomEntry("fe-state", encodeState(nextState));
          sm.appendSessionInfo(sessionName);
        },
        withSession: async (newCtx) => {
          // Per pi's documented session-replacement footguns, ONLY
          // use the fresh `newCtx` for session-bound work. Do not
          // touch the captured `pi` or the old command `ctx` here.
          //
          // The new session's `sessionManager` is typed as `ReadonlySessionManager`
          // on `ReplacedSessionContext`, but the underlying object is the new
          // session's writable `SessionManager` (same one the `setup` callback
          // above received). The `appendCustomEntry` cast below matches the
          // existing `as unknown as SkillSessionContext` cast pattern in this
          // file — the runtime supports the call.
          const sCtx: SkillSessionContext = {
            ui: newCtx.ui,
            sendUserMessage: (content) => newCtx.sendUserMessage(content),
            waitForIdle: () => newCtx.waitForIdle(),
            compact: (options) => newCtx.compact(options),
            cwd: newCtx.cwd,
            appendCustomEntry: (customType, data) => {
              (
                newCtx.sessionManager as unknown as {
                  appendCustomEntry: (t: string, d?: unknown) => string;
                }
              ).appendCustomEntry(customType, data);
            },
          };
          if (options.beforeStart) {
            await options.beforeStart(sCtx, nextState);
          }
          await sCtx.sendUserMessage(prompt);

          if (options.intermediateSteps && options.intermediateSteps.length > 0) {
            await driveIntermediateSteps(sCtx, options.intermediateSteps);
            if (options.finalCompactInstructions !== undefined) {
              await runCompaction(sCtx, options.finalCompactInstructions);
            }
            if (options.onLlmTurnEnd) {
              await options.onLlmTurnEnd(sCtx);
            }
            // The last intermediate step is the final LLM turn for
            // this skill. Skip afterSend to avoid double-waiting.
            return;
          }

          if (options.finalCompactInstructions !== undefined) {
            // No intermediate steps — wait for the LLM to finish
            // its single turn, then run the final compaction before
            // handing off to afterSend. Satisfies PRD §11 rule 6
            // for single-shot automated skills.
            await sCtx.waitForIdle();
            await runCompaction(sCtx, options.finalCompactInstructions);
          }

          if (options.onLlmTurnEnd) {
            await options.onLlmTurnEnd(sCtx);
          }

          if (options.afterSend) {
            await options.afterSend(sCtx, nextState);
          }
        },
      });
    } catch (e) {
      lastError = e;
      if (wasLastAttemptThrottled() && attempt < maxAttempts) {
        // 429 hit. Notify the user and loop to retry after the gate
        // polls. The new attempt creates a fresh session, so the
        // aborted session's failure doesn't pollute the LLM context.
        ctx.ui.notify(
          `Feature Engineer: rate limit on ${stepDisplayName(nextState.step)} (attempt ${attempt}/${maxAttempts}). Polling until window resets, then retrying.`,
          "warning",
        );
        continue;
      }
      // Not a rate-limit abort, or out of attempts.
      throw e;
    }
  }

  // All attempts exhausted. Surface the last error.
  if (lastError instanceof Error) throw lastError;
  throw new Error(
    `Feature Engineer: ${stepDisplayName(nextState.step)} failed after ${maxAttempts} rate-limited attempts. Use /feature to retry.`,
  );
}

/**
 * Drives a sequence of intermediate prompts with deterministic compaction
 * between them. Each step: send prompt → wait for idle → compact (between
 * steps only — the last step is not compacted here; use
 * `finalCompactInstructions` on `startSkillSession` to compact after the
 * last step).
 *
 * Exported for testability.
 */
export async function driveIntermediateSteps(
  sCtx: SkillSessionContext,
  steps: readonly IntermediateStep[],
): Promise<void> {
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const resolvedPrompt = typeof step.prompt === "function" ? step.prompt() : step.prompt;
    await sCtx.sendUserMessage(resolvedPrompt);
    await sCtx.waitForIdle();
    if (i < steps.length - 1 && step.compactInstructions !== undefined) {
      await runCompaction(sCtx, step.compactInstructions);
    }
  }
}

/**
 * Triggers compaction and awaits completion. Resolves on either `onComplete`
 * or `onError` so the caller never hangs on a broken compaction callback.
 *
 * Exported so automated skills can call this directly in their `afterSend`
 * hook if they need custom compaction timing beyond what
 * `finalCompactInstructions` provides.
 */
export function runCompaction(sCtx: SkillSessionContext, customInstructions: string): Promise<void> {
  return new Promise<void>((resolve) => {
    sCtx.compact({
      customInstructions,
      onComplete: () => resolve(),
      onError: () => resolve(),
    });
  });
}

export interface IntermediateStep {
  /**
   * Prompt text to send to the LLM for this step.
   *
   * May be a plain string, or a zero-arg function returning a string. The
   * function form is resolved immediately before `sendUserMessage` is
   * called for this step (in `driveIntermediateSteps`), NOT when the
   * `steps` array is constructed. Use this for prompts that must reflect
   * fresh file/state content as of send time — e.g. a review pass whose
   * prompt embeds a concerns file that an earlier pass may have just
   * appended to. Plain string prompts are sent unchanged, preserving
   * existing behavior.
   */
  prompt: string | (() => string);
  /**
   * Compaction instructions applied AFTER this step completes and BEFORE
   * the next step begins. Ignored for the last step (nothing follows) UNLESS
   * `finalCompactInstructions` is also set on the parent `startSkillSession`
   * options — in which case the last step is compacted with those
   * instructions to satisfy PRD §11 rule 6.
   */
  compactInstructions?: string;
}

export interface StartSkillSessionOptions {
  /**
   * Optional hook called AFTER `setSessionName` but BEFORE sending the prompt.
   * Useful for sending an introductory `ui.notify` to the user.
   */
  beforeStart?: (newCtx: SkillSessionContext, state: FeatureState) => Promise<void>;
  /**
   * Optional hook called AFTER the prompt is sent. Use this for automated
   * skills that want to call `waitForIdle()` and then drive subsequent steps.
   *
   * NOTE: not invoked when `intermediateSteps` is provided — intermediate
   * steps are the final LLM turn in that case.
   */
  afterSend?: (newCtx: SkillSessionContext, state: FeatureState) => Promise<void>;
  /**
   * Optional sequence of follow-up prompts the runner drives deterministically.
   * After the initial prompt, the runner sends each step's prompt, waits for
   * idle, and (between steps) compacts with the step's `compactInstructions`.
   *
   * Use this for skills that have a multi-phase flow (intermediate scan →
   * compact → final draft) or that run a loop of related prompts.
   */
  intermediateSteps?: readonly IntermediateStep[];
  /**
   * Compaction instructions applied AFTER the skill's final LLM turn and
   * BEFORE the orchestrator's `onComplete` callback runs (or the runner
   * resolves the new session). Satisfies PRD §11 rule 6: "Pi's
   * `ctx.compact()` is called explicitly after each automated step's output
   * is written, before the session transitions."
   *
   * For multi-phase skills (those with `intermediateSteps`), the final
   * compaction is applied AFTER the last intermediate step completes.
   *
   * For single-shot automated skills (test-builder, impl-builder,
   * github), the final compaction is applied AFTER the LLM's only turn
   * (i.e. after `waitForIdle`) but BEFORE `afterSend` runs.
   *
   * When omitted, no final compaction is performed — only inter-step
   * compactions (if any) run. Interactive skills should omit this field
   * since the user is the one working in the session.
   */
  finalCompactInstructions?: string;
  /**
   * Optional hook called inside the new session AFTER the LLM turn ends
   * and AFTER any final compaction. Has access to the new session's
   * `cwd` and `appendCustomEntry`, so callers can run session-bound work
   * and persist custom entries that survive Pi restarts.
   *
   * Used by Implementation Builder to run the orchestrator-driven QA pass
   * and persist `implFailed: true` on QA exhaustion, so the recovery UX
   * (PRD §9.8) survives a Pi restart.
   *
   * Not invoked when the session is cancelled mid-turn (the LLM session
   * will not have reached the post-turn checkpoint). For multi-phase
   * skills with `intermediateSteps`, this fires once at the very end
   * (after the last step + final compaction).
   */
  onLlmTurnEnd?: (sCtx: SkillSessionContext) => Promise<void>;
  /**
   * Maximum number of attempts when a 429-induced abort fires during
   * the stage. Each attempt creates a fresh session and pays the
   * rate-limit gate's poll before re-sending the prompt. Default 3.
   * Set to 1 to disable the retry (single attempt, then surface
   * failure to the orchestrator).
   */
  maxAttempts?: number;
}

/** Sends a notify message and waits for the agent to be idle. */
export async function notifyAndWait(
  ctx: SkillSessionContext,
  message: string,
  level: "info" | "warning" | "error" = "info",
): Promise<void> {
  ctx.ui.notify(message, level);
  await ctx.waitForIdle();
}

/**
 * Default `afterSend` for automated skills: wait for the LLM to finish, then
 * invoke `onComplete` to let the orchestrator advance.
 *
 * NOTE: with the addition of `finalCompactInstructions` on
 * `startSkillSession`, callers should set that field rather than calling
 * this directly — the runner will `waitForIdle` and compact in the right
 * order. This helper is kept for skills that need to chain additional
 * work after the LLM's turn but before `onComplete`.
 */
export async function waitAndComplete(
  ctx: SkillSessionContext,
  state: FeatureState,
  onComplete: (state: FeatureState) => Promise<void>,
): Promise<void> {
  await ctx.waitForIdle();
  await onComplete(state);
}
