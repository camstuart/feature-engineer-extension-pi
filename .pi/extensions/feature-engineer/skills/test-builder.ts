/**
 * Test Builder SKILL runner.
 *
 * Automated skill: writes failing test files (red phase of TDD), runs
 * syntax validation, and signals completion via the `onComplete` callback.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readArtifact, readConfigFile } from "../files.js";
import { buildTestBuilderPrompt } from "../prompts/test-builder.js";
import { type FeatureState } from "../state.js";
import { startSkillSession, waitAndComplete } from "./runner.js";

export async function runTestBuilder(
  ctx: ExtensionCommandContext,
  state: FeatureState,
  options: AutomatedSkillOptions = {},
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

  const prompt = buildTestBuilderPrompt({
    architecture,
    testPlan,
    implPlan,
    structure,
    techStack,
    qaStaticTools,
    state,
  });

  return startSkillSession(ctx, { ...state, rejectionFeedback: undefined }, prompt, {
    finalCompactInstructions: `Summarise only: Test Builder finished for feature ${state.featureSlug}. Preserve the list of test files written and the test counts per file. The next session will start from this summary.`,
    afterSend: async (newCtx, s) => {
      await waitAndComplete(newCtx, s, options.onComplete ?? (async () => {}));
    },
  });
}

export interface AutomatedSkillOptions {
  /** Invoked after the skill session completes (waitForIdle resolves). */
  onComplete?: (state: FeatureState) => Promise<void>;
}
