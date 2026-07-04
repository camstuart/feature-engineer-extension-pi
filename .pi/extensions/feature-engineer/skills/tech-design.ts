/**
 * Technical Design SKILL runner.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readArtifact, readConfigFile, readTemplate } from "../files.js";
import { artifactPath, artifactTemplatePath, relevantComponentsPath } from "../paths.js";
import {
  buildTechDesignPhase1Prompt,
  buildTechDesignPhase2Prompt,
  type TechDesignPromptInputs,
} from "../prompts/tech-design.js";
import { type FeatureState } from "../state.js";
import { startSkillSession, type IntermediateStep } from "./runner.js";

export async function runTechDesign(
  ctx: ExtensionCommandContext,
  state: FeatureState,
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const template = readTemplate("artifact", "technical-architecture");
  const requirement = readArtifact(cwd, state.featureId, state.featureSlug, "requirement");
  const structure = readConfigFile(cwd, "structure");
  const techStack = readConfigFile(cwd, "tech-stack");
  const qaEngineering = readConfigFile(cwd, "qa-engineering");
  const existingArchitecture = readArtifact(
    cwd,
    state.featureId,
    state.featureSlug,
    "technical-architecture",
  );

  if (template === null) {
    ctx.ui.notify(`Feature Engineer: missing template ${artifactTemplatePath("technical-architecture")}.`, "error");
    return { cancelled: true };
  }
  if (requirement === null) {
    ctx.ui.notify("Feature Engineer: requirement.md is missing. Requirement Gathering must complete first.", "error");
    return { cancelled: true };
  }
  if (structure === null || techStack === null || qaEngineering === null) {
    ctx.ui.notify(
      "Feature Engineer: structure.md, tech-stack.md, or qa-engineering.md is missing. Run /feature to initialise.",
      "error",
    );
    return { cancelled: true };
  }

  const inputs: TechDesignPromptInputs = {
    template,
    requirement,
    structure,
    techStack,
    qaEngineering,
    existingArchitecture,
    state,
    rejectionFeedback: state.rejectionFeedback ?? null,
    outputPath: artifactPath(cwd, state.featureId, state.featureSlug, "technical-architecture"),
    relevantComponentsPath: relevantComponentsPath(cwd, state.featureId, state.featureSlug),
  };

  const initialPrompt = buildTechDesignPhase1Prompt(inputs);
  const phase2 = buildTechDesignPhase2Prompt(inputs);

  const intermediateSteps: IntermediateStep[] = [
    {
      prompt: phase2,
      compactInstructions: `Summarise only: the path of relevant-components.md and the high-level list of reusable components. The next phase will draft technical-architecture.md from this summary.`,
    },
  ];

  return startSkillSession(ctx, { ...state, rejectionFeedback: undefined }, initialPrompt, {
    intermediateSteps,
    // Final compaction: after the user's phase-2 review writes
    // technical-architecture.md, compact before the orchestrator transitions
    // to Test Planning. Satisfies PRD §11 rule 6 ("Multi-step skills: the
    // final compaction fires AFTER the last intermediate step").
    finalCompactInstructions: `Summarise only: Technical Design finished for feature ${state.featureSlug}. Preserve the high-level component list, key architectural decisions, and the path of technical-architecture.md. The next session (Test Planning) will start from this summary.`,
  });
}