/**
 * GitHub SKILL runner.
 *
 * Automated skill: creates a feature branch, commits per the project's git
 * strategy, pushes, opens a PR if `gh` is available, and updates
 * features-index.md. On completion the orchestrator is notified.
 *
 * The orchestrator detects `gh` CLI availability (via `sessionManager.exec`)
 * and passes the boolean to the prompt as a literal fact — the LLM is not
 * trusted to discover this on its own.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { readArtifact, readConfigFile } from "../files.js";
import { todayIso } from "../dates.js";
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