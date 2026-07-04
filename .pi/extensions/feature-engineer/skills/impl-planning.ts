/**
 * Implementation Planning SKILL runner.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readArtifact, readConfigFile, readTemplate } from "../files.js";
import { artifactPath, artifactTemplatePath } from "../paths.js";
import { buildImplPlanningPrompt } from "../prompts/impl-planning.js";
import { type FeatureState } from "../state.js";
import { startSkillSession } from "./runner.js";

export async function runImplPlanning(
  ctx: ExtensionCommandContext,
  state: FeatureState,
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const template = readTemplate("artifact", "technical-plan-implementation");
  const requirement = readArtifact(cwd, state.featureId, state.featureSlug, "requirement");
  const architecture = readArtifact(
    cwd,
    state.featureId,
    state.featureSlug,
    "technical-architecture",
  );
  const testPlan = readArtifact(cwd, state.featureId, state.featureSlug, "technical-plan-testing");
  const structure = readConfigFile(cwd, "structure");
  const qaEngineering = readConfigFile(cwd, "qa-engineering");
  const gitStrategy = readConfigFile(cwd, "git-strategy");
  const existingImplPlan = readArtifact(
    cwd,
    state.featureId,
    state.featureSlug,
    "technical-plan-implementation",
  );

  if (template === null) {
    ctx.ui.notify(`Feature Engineer: missing template ${artifactTemplatePath("technical-plan-implementation")}.`, "error");
    return { cancelled: true };
  }
  if (requirement === null || architecture === null || testPlan === null) {
    ctx.ui.notify("Feature Engineer: prior planning artifacts are missing.", "error");
    return { cancelled: true };
  }
  if (structure === null || qaEngineering === null || gitStrategy === null) {
    ctx.ui.notify("Feature Engineer: project config files are missing. Run /feature to initialise.", "error");
    return { cancelled: true };
  }

  const prompt = buildImplPlanningPrompt({
    template,
    requirement,
    architecture,
    testPlan,
    structure,
    qaEngineering,
    gitStrategy,
    existingImplPlan,
    state,
    rejectionFeedback: state.rejectionFeedback ?? null,
    outputPath: artifactPath(cwd, state.featureId, state.featureSlug, "technical-plan-implementation"),
  });

  return startSkillSession(ctx, { ...state, rejectionFeedback: undefined }, prompt);
}
