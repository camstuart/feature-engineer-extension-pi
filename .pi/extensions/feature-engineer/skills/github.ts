/**
 * GitHub SKILL runner.
 *
 * Automated skill: the feature branch was already created/checked out by
 * `index.ts`'s `handleApprove` on approving `impl-planning`, and all
 * implementation commits were already made by earlier skills (impl-builder).
 * This skill's job is reduced to: push the branch, open a PR if `gh` is
 * available and the strategy calls for one, and update features-index.md.
 * On completion the orchestrator is notified.
 *
 * Before starting the LLM session, the orchestrator deterministically
 * verifies commits exist on the feature branch relative to the configured
 * base branch (via `git-checks.ts`'s `countCommitsSinceBase`) — matching
 * this codebase's established pattern (impl-builder's QA check,
 * test-builder's red-phase check) of "orchestrator is authoritative for
 * anything deterministic; don't trust the LLM to self-report." Zero commits
 * is reported via `notify` and the skill returns `{ cancelled: true }`
 * without ever starting a session.
 *
 * The orchestrator detects `gh` CLI availability (via `sessionManager.exec`)
 * and passes the boolean to the prompt as a literal fact — the LLM is not
 * trusted to discover this on its own.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readArtifact, readConfigFile } from "../files.js";
import { todayIso } from "../dates.js";
import { countCommitsSinceBase, parseGitStrategyConfig } from "../git-checks.js";
import { featureIndexPath } from "../paths.js";
import { buildGithubPrompt } from "../prompts/github.js";
import { type FeatureState } from "../state.js";
import { startSkillSession, waitAndComplete } from "./runner.js";
import type { AutomatedSkillOptions } from "./test-builder.js";

/**
 * Detect whether the `gh` CLI is available. We treat `gh --version` exit 0
 * as a positive signal; any non-zero exit (or exec error) is a negative.
 *
 * Uses `child_process.execFileSync` directly (rather than
 * `ctx.sessionManager.exec`) because the extension's command context exposes
 * only a `ReadonlySessionManager`, which does not have `exec`.
 */
function isGhAvailable(): boolean {
  try {
    const stdout = execFileSync("gh", ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    return stdout.length > 0;
  } catch {
    return false;
  }
}

export async function runGithub(
  ctx: ExtensionCommandContext,
  state: FeatureState,
  options: AutomatedSkillOptions = {},
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const gitStrategy = readConfigFile(cwd, "git-strategy");
  const requirement = readArtifact(cwd, state.featureId, state.featureSlug, "requirement");

  if (gitStrategy === null) {
    ctx.ui.notify(
      "Feature Engineer: git-strategy.md is missing. Run /feature to initialise.",
      "error",
    );
    return { cancelled: true };
  }
  if (requirement === null) {
    ctx.ui.notify("Feature Engineer: requirement.md is missing.", "error");
    return { cancelled: true };
  }

  const config = parseGitStrategyConfig(gitStrategy);
  const commitCount = countCommitsSinceBase(cwd, config.baseBranch);
  if (commitCount === 0) {
    ctx.ui.notify(
      `Feature Engineer: no commits found on the feature branch relative to ${config.baseBranch}. Commit the implementation work, then re-approve to push and open a PR.`,
      "error",
    );
    return { cancelled: true };
  }
  // `commitCount === null` means the check couldn't be determined (e.g. the
  // base branch doesn't exist locally, or cwd isn't a git repo) — a
  // degraded-capability situation, not a real "no commits" finding, so we
  // proceed anyway (matches git-checks.ts's own graceful-degradation
  // philosophy).

  const ghAvailable = isGhAvailable();

  const prompt = buildGithubPrompt({
    gitStrategy,
    requirement,
    featuresIndexPath: featureIndexPath(cwd),
    state,
    completionDate: todayIso(),
    ghAvailable,
  });

  return startSkillSession(ctx, { ...state, rejectionFeedback: undefined }, prompt, {
    finalCompactInstructions: `Summarise only: GitHub skill finished for feature ${state.featureSlug}. Preserve the branch name, commit hashes, and PR URL (or 'none'). The workflow is complete after this.`,
    afterSend: async (newCtx, s) => {
      await waitAndComplete(newCtx, s, options.onComplete ?? (async () => {}));
    },
  });
}