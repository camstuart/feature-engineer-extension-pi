/**
 * Requirement Gathering SKILL runner.
 *
 * Interactive skill. Reads the actors config and (for EXISTING features)
 * the existing requirement.md, then drafts and reviews a new requirement.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readArtifact, readConfigFile, readTemplate } from "../files.js";
import { artifactPath, artifactTemplatePath } from "../paths.js";
import { buildReqGatheringPrompt } from "../prompts/req-gathering.js";
import { type FeatureState } from "../state.js";
import { startSkillSession } from "./runner.js";

export async function runReqGathering(
  ctx: ExtensionCommandContext,
  state: FeatureState,
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const template = readTemplate("artifact", "requirement");
  const actors = readConfigFile(cwd, "actors");
  const existingRequirement = readArtifact(cwd, state.featureId, state.featureSlug, "requirement");

  if (template === null) {
    ctx.ui.notify(
      `Feature Engineer: missing template ${artifactTemplatePath("requirement")}. Run /feature again after the template is in place.`,
      "error",
    );
    return { cancelled: true };
  }
  if (actors === null) {
    ctx.ui.notify("Feature Engineer: actors.md is missing or empty. Run /feature to initialise the project.", "error");
    return { cancelled: true };
  }

  const prompt = buildReqGatheringPrompt({
    template,
    actors,
    existingRequirement,
    state,
    rejectionFeedback: state.rejectionFeedback ?? null,
    outputPath: artifactPath(cwd, state.featureId, state.featureSlug, "requirement"),
    // The orchestrator is responsible for prompting the user for the mode
    // (see `handleNewOrExisting` and the resume path in `handleRun`).
    // We pass through whatever the state has. A missing mode here means
    // the orchestrator skipped its check — fail loudly rather than
    // silently defaulting to "vague", which the PRD does not sanction.
    mode: state.requirementMode,
  });

  return startSkillSession(ctx, { ...state, rejectionFeedback: undefined }, prompt);
}
