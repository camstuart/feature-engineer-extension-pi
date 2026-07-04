/**
 * Testing and QA Planning SKILL runner.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readArtifact, readConfigFile, readTemplate } from "../files.js";
import { artifactPath, artifactTemplatePath } from "../paths.js";
import { buildTestPlanningPrompt } from "../prompts/test-planning.js";
import { type FeatureState } from "../state.js";
import { startSkillSession } from "./runner.js";

export async function runTestPlanning(
  ctx: ExtensionCommandContext,
  state: FeatureState,
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const template = readTemplate("artifact", "technical-plan-testing");
  const requirement = readArtifact(cwd, state.featureId, state.featureSlug, "requirement");
  const architecture = readArtifact(
    cwd,
    state.featureId,
    state.featureSlug,
    "technical-architecture",
  );
  const structure = readConfigFile(cwd, "structure");
  const techStack = readConfigFile(cwd, "tech-stack");
  const qaStaticTools = readConfigFile(cwd, "qa-static-tools");
  const qaEngineering = readConfigFile(cwd, "qa-engineering");
  const existingTestPlan = readArtifact(
    cwd,
    state.featureId,
    state.featureSlug,
    "technical-plan-testing",
  );

  if (template === null) {
    ctx.ui.notify(`Feature Engineer: missing template ${artifactTemplatePath("technical-plan-testing")}.`, "error");
    return { cancelled: true };
  }
  if (requirement === null || architecture === null) {
    ctx.ui.notify(
      "Feature Engineer: requirement.md or technical-architecture.md is missing. Previous skills must complete first.",
      "error",
    );
    return { cancelled: true };
  }
  if (structure === null || techStack === null || qaStaticTools === null || qaEngineering === null) {
    ctx.ui.notify(
      "Feature Engineer: project config files are missing. Run /feature to initialise.",
      "error",
    );
    return { cancelled: true };
  }

  const prompt = buildTestPlanningPrompt({
    template,
    requirement,
    architecture,
    structure,
    techStack,
    qaStaticTools,
    qaEngineering,
    existingTestPlan,
    state,
    rejectionFeedback: state.rejectionFeedback ?? null,
    outputPath: artifactPath(cwd, state.featureId, state.featureSlug, "technical-plan-testing"),
  });

  return startSkillSession(ctx, { ...state, rejectionFeedback: undefined }, prompt);
}
