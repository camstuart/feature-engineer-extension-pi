/**
 * Implementation Builder SKILL runner.
 *
 * Automated skill with an **orchestrator-driven QA retry loop**. Each
 * attempt:
 *   1. Starts a fresh Pi session and sends the impl-builder prompt.
 *   2. Waits for the LLM to finish (waitForIdle).
 *   3. Runs every parsed QA command from `04-qa-static-tools.md` itself
 *      using `runQACommands`. The orchestrator is authoritative — the
 *      LLM's own QA pass is treated as a sanity check only.
 *   4. If all QA commands pass, calls `onComplete` and returns.
 *   5. If anything fails and we still have retries left, builds a retry
 *      prompt with the failure output and starts the next attempt in a
 *      fresh session. Up to `maxRetries` total attempts.
 *   6. If the last attempt still fails, surfaces the failure to the user
 *      and returns `cancelled: true`. The workflow does not auto-advance.
 *
 * This is the per-PRD-§9.8 "Max 3 retries per task before surfacing to
 * user" behaviour. The LLM is no longer trusted to self-report QA status
 * (the prior design asked it to do so and the failure mode was an LLM
 * declaring DONE when the suite was red).
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { encodeState, FE_STATE_CUSTOM_TYPE } from "../persistence.js";
import { readArtifact, readConfigFile } from "../files.js";
import {
  parseQAStaticTools,
  runQACommands,
  formatFailureFeedback,
  type QACommands,
  type QARunResult,
} from "../qa.js";
import {
  buildImplBuilderPrompt,
  buildImplBuilderRetryPrompt,
} from "../prompts/impl-builder.js";
import { type FeatureState } from "../state.js";
import { startSkillSession } from "./runner.js";
import type { AutomatedSkillOptions } from "./test-builder.js";

export const DEFAULT_MAX_RETRIES = 3;

/**
 * Outcome of a single `runImplBuilder` invocation.
 *
 * - `success` — every QA tool passed within the retry budget; the
 *   orchestrator's `onComplete` has already fired (auto-advance to review).
 * - `user-cancelled` — the LLM session was aborted (signal, Ctrl+C, etc.).
 *   The orchestrator should not advance.
 * - `qa-exhausted` — the retry budget was spent without a clean QA pass.
 *   The orchestrator sets `implFailed: true` on the state so the user can
 *   recover via `/feature approve` (retry as-is) or
 *   `/feature reject <feedback>` (loop back to impl-planning). Satisfies
 *   PRD §9.8's "workflow pauses" UX.
 */
export type ImplBuilderResult =
  | { outcome: "success" }
  | { outcome: "user-cancelled" }
  | { outcome: "qa-exhausted"; failureSummary: string };

export async function runImplBuilder(
  ctx: ExtensionCommandContext,
  state: FeatureState,
  options: ImplBuilderOptions = {},
): Promise<ImplBuilderResult> {
  const cwd = ctx.cwd;
  const architecture = readArtifact(cwd, state.featureId, state.featureSlug, "technical-architecture");
  const testPlan = readArtifact(cwd, state.featureId, state.featureSlug, "technical-plan-testing");
  const implPlan = readArtifact(cwd, state.featureId, state.featureSlug, "technical-plan-implementation");
  const structure = readConfigFile(cwd, "structure");
  const techStack = readConfigFile(cwd, "tech-stack");
  const qaStaticTools = readConfigFile(cwd, "qa-static-tools");
  const qaEngineering = readConfigFile(cwd, "qa-engineering");

  if (
    architecture === null ||
    testPlan === null ||
    implPlan === null ||
    structure === null ||
    techStack === null ||
    qaStaticTools === null ||
    qaEngineering === null
  ) {
    ctx.ui.notify("Feature Engineer: missing inputs for Implementation Builder.", "error");
    return { outcome: "user-cancelled" };
  }

  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const qaCommands: QACommands = parseQAStaticTools(qaStaticTools);
  const prompt = buildImplBuilderPrompt({
    architecture,
    testPlan,
    implPlan,
    structure,
    techStack,
    qaStaticTools,
    qaEngineering,
    state,
    maxRetries,
    reviewConcerns: state.reviewConcerns ?? null,
  });

  const finalCompactInstructions = `Summarise only: Implementation Builder finished for feature ${state.featureSlug}. Preserve the list of completed tasks, the commit hashes, and the QA result (pass/fail). The next session will start from this summary.`;

  // Attempt loop. Each iteration is a fresh Pi session with its own prompt
  // (initial on attempt 1, retry on attempts 2+). After every session,
  // the orchestrator runs the QA suite itself. If anything fails, the
  // failure output is fed into the next retry's prompt.
  //
  // QA runs inside the runner's `onLlmTurnEnd` hook (inside `withSession`,
  // AFTER the LLM turn and AFTER final compaction) so we have access to the
  // new session's `appendCustomEntry`. That lets us persist the failure
  // state to fe-state, which survives Pi restarts and makes the recovery
  // UX (PRD §9.8) work even after a Pi reload.
  let lastFailures: QARunResult[] | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const isRetry = attempt > 1;
    const sessionPrompt = isRetry
      ? buildImplBuilderRetryPrompt({
          state,
          attempt,
          maxAttempts: maxRetries,
          failureFeedback: formatFailureFeedback(lastFailures ?? []),
          implPlan,
          reviewConcerns: state.reviewConcerns ?? null,
        })
      : prompt;

    ctx.ui.notify(
      isRetry
        ? `Feature Engineer: Implementation Builder — retry ${attempt}/${maxRetries}.`
        : `Feature Engineer: Implementation Builder — attempt 1/${maxRetries}.`,
      "info",
    );

    // The LLM does its turn. Each attempt is a new session so the LLM
    // gets a fresh context, plus the failure feedback (on retries). After
    // the LLM finishes, `onLlmTurnEnd` runs QA and (on the last attempt's
    // failure) persists `implFailed: true` to the new session's fe-state.
    const result = await startSkillSession(
      ctx,
      { ...state, rejectionFeedback: undefined },
      sessionPrompt,
      {
        finalCompactInstructions,
        onLlmTurnEnd: async (sCtx) => {
          const qaResults = runQACommands(sCtx.cwd, qaCommands);
          const failures = qaResults.filter((r) => r.exitCode !== 0);
          lastFailures = failures;
          // Only persist on the LAST attempt's failure. Earlier failures
          // are about to be retried in a fresh session, so writing them
          // would clutter the impl-builder branch with stale entries.
          // On the final failure, the workflow pauses here and the user
          // can recover via `/feature approve` / `/feature reject`; the
          // persisted entry ensures the `implFailed: true` flag survives
          // a Pi restart.
          if (failures.length > 0 && attempt === maxRetries) {
            sCtx.appendCustomEntry(
              FE_STATE_CUSTOM_TYPE,
              encodeState({ ...state, implFailed: true }),
            );
          }
        },
      },
    );

    if (result.cancelled) {
      return { outcome: "user-cancelled" };
    }

    // `lastFailures` was set by `onLlmTurnEnd` inside the runner. Treat
    // null as a user-cancellation (LLM session aborted before the
    // post-turn checkpoint).
    const failures: readonly QARunResult[] =
      lastFailures ?? ([] as readonly QARunResult[]);
    if (lastFailures === null) {
      return { outcome: "user-cancelled" };
    }

    if (failures.length === 0) {
      // All green — auto-advance.
      if (options.onComplete) await options.onComplete(state);
      return { outcome: "success" };
    }

    if (attempt < maxRetries) {
      ctx.ui.notify(
        `Feature Engineer: ${failures.length} QA tool(s) failed on attempt ${attempt}. Retrying.`,
        "warning",
      );
    } else {
      // Out of retries — surface to user and DO NOT auto-advance. The
      // orchestrator reads `outcome: "qa-exhausted"` and sets
      // `implFailed: true` on the state so /feature approve (retry as-is)
      // and /feature reject <feedback> (loop back to impl-planning) work.
      const summary = formatFailureFeedback(failures);
      ctx.ui.notify(
        `Feature Engineer: Implementation Builder failed after ${maxRetries} attempts. The workflow is paused — review the failures and run /feature approve to retry, or /feature reject <feedback> to revise the plan.\n\n${summary}`,
        "error",
      );
      return { outcome: "qa-exhausted", failureSummary: summary };
    }
  }

  // Unreachable — the loop either returns success or the last iteration
  // returns the failure-and-stop branch. Keep the type-checker happy.
  return { outcome: "user-cancelled" };
}

export interface ImplBuilderOptions extends AutomatedSkillOptions {
  /** Maximum total attempts (initial + retries). Default 3. */
  maxRetries?: number;
}
