/**
 * Test Builder SKILL runner.
 *
 * Automated skill: writes failing test files (red phase of TDD). After the
 * LLM's turn, the orchestrator runs a **deterministic red-phase check**
 * (`checkRedPhase` in `qa.ts`) rather than trusting the LLM's self-report:
 * the type-checker (if configured) must exit 0, and the test runner (if
 * configured) must exit non-zero. On a violation, the orchestrator re-runs
 * the skill once more in a fresh session with a retry prompt describing the
 * observed outcome. If the second attempt still violates the invariant, the
 * workflow pauses at `step: "test-builder"` — the LLM is not advanced
 * automatically, and a subsequent `/feature` re-runs Test Builder from
 * scratch.
 *
 * The "tests must fail" half of that invariant only holds on a feature's
 * FIRST build cycle. When an ARCHITECTURAL review concern routes back
 * through tech-design → test-planning → impl-planning → test-builder, a
 * prior cycle's implementation is still on disk, so revised tests may
 * legitimately already pass. Before invoking `checkRedPhase`, this runner
 * checks `countCommitsSinceBase` (`git-checks.ts`) — commits already on the
 * branch relative to the configured base branch are positive evidence that
 * an implementation exists, and in that case `checkRedPhase` is called with
 * `enforceTestsMustFail: false` so a passing test run is not treated as a
 * violation. The type-check-must-pass requirement is unaffected. When the
 * commit count can't be determined (missing config, missing base branch,
 * not a git repo), this falls back to the original full enforcement.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readArtifact, readConfigFile } from "../files.js";
import { countCommitsSinceBase, parseGitStrategyConfig } from "../git-checks.js";
import {
  checkRedPhase,
  formatCommandOutput,
  formatFailureFeedback,
  parseQAStaticTools,
  type RedPhaseViolation,
} from "../qa.js";
import { buildTestBuilderPrompt, buildTestBuilderRetryPrompt } from "../prompts/test-builder.js";
import { type FeatureState } from "../state.js";
import { startSkillSession } from "./runner.js";

/** Initial attempt plus one retry — matches the impl-builder QA loop's shape. */
export const DEFAULT_MAX_ATTEMPTS = 2;

/**
 * Renders a red-phase violation's observed output for feedback purposes.
 * `formatFailureFeedback` filters to non-zero exit codes, which is wrong
 * for `tests-passed` violations — there the "violation" IS a 0 exit code,
 * and we specifically want to show that command's output (not the generic
 * "All QA tools passed." fallback `formatFailureFeedback` would produce).
 */
function formatViolationFeedback(violation: RedPhaseViolation): string {
  return violation.kind === "tests-passed"
    ? formatCommandOutput(violation.result)
    : formatFailureFeedback([violation.result]);
}

export async function runTestBuilder(
  ctx: ExtensionCommandContext,
  state: FeatureState,
  options: TestBuilderOptions = {},
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const architecture = readArtifact(cwd, state.featureId, state.featureSlug, "technical-architecture");
  const testPlan = readArtifact(cwd, state.featureId, state.featureSlug, "technical-plan-testing");
  const implPlan = readArtifact(cwd, state.featureId, state.featureSlug, "technical-plan-implementation");
  const structure = readConfigFile(cwd, "structure");
  const techStack = readConfigFile(cwd, "tech-stack");
  const qaStaticTools = readConfigFile(cwd, "qa-static-tools");

  if (
    architecture === null ||
    testPlan === null ||
    implPlan === null ||
    structure === null ||
    techStack === null ||
    qaStaticTools === null
  ) {
    ctx.ui.notify("Feature Engineer: missing inputs for Test Builder.", "error");
    return { cancelled: true };
  }

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const qaCommands = parseQAStaticTools(qaStaticTools);

  // Determine whether an implementation from a PRIOR build cycle already
  // exists on this branch (e.g. an ARCHITECTURAL review concern routed the
  // workflow back through tech-design → test-planning → impl-planning →
  // test-builder a second time). If so, the red-phase "tests must fail"
  // invariant no longer holds meaningfully — see `checkRedPhase`'s
  // `enforceTestsMustFail` doc comment. Only skip the enforcement on
  // POSITIVE evidence (commit count > 0); any degraded/undeterminable case
  // (missing git-strategy.md, missing base branch, not a git repo) falls
  // back to the original full enforcement.
  const gitStrategy = readConfigFile(cwd, "git-strategy");
  let hasExistingImplementation = false;
  if (gitStrategy !== null) {
    const gitStrategyConfig = parseGitStrategyConfig(gitStrategy);
    const commitCount = countCommitsSinceBase(cwd, gitStrategyConfig.baseBranch);
    hasExistingImplementation = commitCount !== null && commitCount > 0;
  }
  const prompt = buildTestBuilderPrompt({
    architecture,
    testPlan,
    implPlan,
    structure,
    techStack,
    qaStaticTools,
    state,
  });
  const finalCompactInstructions = `Summarise only: Test Builder finished for feature ${state.featureSlug}. Preserve the list of test files written and the test counts per file. The next session will start from this summary.`;

  // `undefined` = the red-phase check has not run yet this attempt (guards
  // against a cancelled/aborted session where `onLlmTurnEnd` never fired);
  // `null` = checked clean; a `RedPhaseViolation` = checked and found a
  // problem.
  let lastViolation: RedPhaseViolation | null | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const isRetry = attempt > 1;
    const sessionPrompt = isRetry
      ? buildTestBuilderRetryPrompt({
          state,
          attempt,
          maxAttempts,
          violation: lastViolation!.kind,
          failureFeedback: formatViolationFeedback(lastViolation!),
          implPlan,
        })
      : prompt;

    ctx.ui.notify(
      isRetry
        ? `Feature Engineer: Test Builder — retry ${attempt}/${maxAttempts} (red-phase check failed: ${lastViolation!.kind}).`
        : `Feature Engineer: Test Builder — attempt 1/${maxAttempts}.`,
      isRetry ? "warning" : "info",
    );

    lastViolation = undefined;
    const result = await startSkillSession(
      ctx,
      { ...state, rejectionFeedback: undefined },
      sessionPrompt,
      {
        finalCompactInstructions,
        onLlmTurnEnd: async (sCtx) => {
          lastViolation = checkRedPhase(sCtx.cwd, qaCommands, {
            enforceTestsMustFail: !hasExistingImplementation,
          });
        },
      },
    );

    if (result.cancelled) {
      return { cancelled: true };
    }

    // `onLlmTurnEnd` runs unconditionally after the LLM's turn inside
    // `startSkillSession` (see runner.ts), so this should always be set by
    // the time we get here. Treat the impossible case defensively as a
    // cancellation rather than silently advancing.
    if (lastViolation === undefined) {
      return { cancelled: true };
    }

    if (lastViolation === null) {
      // Red-phase invariant holds: type-check clean, tests fail meaningfully.
      if (options.onComplete) await options.onComplete(state);
      return { cancelled: false };
    }

    if (attempt < maxAttempts) {
      continue;
    }

    // Retry budget exhausted — surface to the user and pause. `state.step`
    // is left at "test-builder" (we never call onComplete), so the next
    // `/feature` invocation re-runs this skill from scratch.
    //
    // The explicit cast (rather than relying on the `lastViolation !==
    // null`/`undefined` narrowing above) works around a TS control-flow
    // limitation: narrowing on a `let` reassigned inside a closure
    // (`onLlmTurnEnd`) is discarded across the `for` loop's `continue`
    // boundary, even though we've already ruled out null/undefined above.
    const violation = lastViolation as RedPhaseViolation;
    ctx.ui.notify(
      `Feature Engineer: Test Builder failed its red-phase check after ${maxAttempts} attempts (${violation.kind}). The workflow is paused — review the output below, then run /feature to retry Test Builder.\n\n${formatViolationFeedback(violation)}`,
      "error",
    );
    return { cancelled: false };
  }

  // Unreachable — the loop always returns on success, on the final
  // failure, or on cancellation. Keep the type-checker happy.
  return { cancelled: false };
}

export interface AutomatedSkillOptions {
  /** Invoked after the skill session completes (waitForIdle resolves). */
  onComplete?: (state: FeatureState) => Promise<void>;
}

export interface TestBuilderOptions extends AutomatedSkillOptions {
  /** Maximum total attempts (initial + retries). Default 2. */
  maxAttempts?: number;
}
