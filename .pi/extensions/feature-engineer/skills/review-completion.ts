/**
 * Review Completion SKILL runner.
 *
 * Automated skill: runs 8 sequential review passes with deterministic
 * compaction between them. After all passes finish, the orchestrator is
 * notified via `onComplete` so it can route to github (no concerns) or
 * concern-severity (concerns found).
 *
 * The runner drives all 8 passes via `intermediateSteps`, with compaction
 * between them. The LLM is not trusted to call `ctx.compact` itself.
 *
 * Each pass (after the first) sees the current `review-concerns-to-address.md`
 * content as background context, so cross-pass findings are visible.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import {
  readArtifact,
  readConfigFile,
  readTemplate,
} from "../files.js";
import { artifactTemplatePath, reviewConcernsPath } from "../paths.js";
import {
  buildReviewPassPrompt,
  REVIEW_PASSES,
} from "../prompts/review-completion.js";
import { type FeatureState } from "../state.js";
import { startSkillSession, type IntermediateStep } from "./runner.js";
import type { AutomatedSkillOptions } from "./test-builder.js";

/** Files the orchestrator must pre-load for the review pass loop.
 *  Keys are on-disk filenames (with numeric prefix). */
const REVIEW_FILE_MAP: Record<string, "config" | "artifact"> = {
  "01-actors.md": "config",
  "02-structure.md": "config",
  "03-tech-stack.md": "config",
  "04-qa-static-tools.md": "config",
  "05-qa-engineering.md": "config",
  "06-git-strategy.md": "config",
  "01-requirement.md": "artifact",
  "03-technical-architecture.md": "artifact",
};

function readReviewFile(
  cwd: string,
  state: FeatureState,
  filename: string,
): string | null {
  const kind = REVIEW_FILE_MAP[filename];
  if (kind === "config") {
    return readConfigFile(
      cwd,
      filename.replace(/^\d+-/, "").replace(/\.md$/, "") as Parameters<typeof readConfigFile>[1],
    );
  }
  if (kind === "artifact") {
    return readArtifact(
      cwd,
      state.featureId,
      state.featureSlug,
      filename.replace(/^\d+-/, "").replace(/\.md$/, "") as Parameters<typeof readArtifact>[3],
    );
  }
  return null;
}

/**
 * Read the current state of the concerns file. Returns null if the file
 * does not yet exist (pass 1 will create it).
 */
function readConcernsFile(cwd: string, id: number, slug: string): string | null {
  const path = reviewConcernsPath(cwd, id, slug);
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export async function runReviewCompletion(
  ctx: ExtensionCommandContext,
  state: FeatureState,
  options: AutomatedSkillOptions = {},
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const template = readTemplate("artifact", "review-concerns");
  if (template === null) {
    ctx.ui.notify(
      `Feature Engineer: missing template ${artifactTemplatePath("review-concerns")}.`,
      "error",
    );
    return { cancelled: true };
  }

  const fileContents: Record<string, string> = {};
  for (const pass of REVIEW_PASSES) {
    for (const filename of pass.files) {
      if (fileContents[filename] !== undefined) continue;
      const content = readReviewFile(cwd, state, filename);
      if (content !== null) fileContents[filename] = content;
    }
  }

  const reviewFilePath = reviewConcernsPath(cwd, state.featureId, state.featureSlug);

  // Pass 1 is the initial prompt; passes 2-8 are intermediate steps driven
  // by the runner with deterministic compaction between them.
  const [firstPass, ...restPasses] = REVIEW_PASSES;
  if (firstPass === undefined) {
    ctx.ui.notify("Feature Engineer: no review passes defined.", "error");
    return { cancelled: true };
  }
  const initialPrompt = buildReviewPassPrompt({
    pass: firstPass,
    fileContents,
    priorConcerns: null,
    state,
    reviewConcernsPath: reviewFilePath,
    template,
  });
  const intermediateSteps: IntermediateStep[] = restPasses.map((pass) => {
    const priorConcerns = readConcernsFile(cwd, state.featureId, state.featureSlug);
    const prompt = buildReviewPassPrompt({
      pass,
      fileContents,
      priorConcerns,
      state,
      reviewConcernsPath: reviewFilePath,
      template,
    });
    return {
      prompt,
      compactInstructions: `Summarise only: review pass ID "${pass.id}" completed, concerns written to ${reviewFilePath}. Preserve the current count of non-empty concern sections.`,
    };
  });

  return startSkillSession(ctx, { ...state, rejectionFeedback: undefined }, initialPrompt, {
    beforeStart: async (sCtx) => {
      sCtx.ui.notify(
        `Feature Engineer: starting review — ${REVIEW_PASSES.length} passes with compaction between.`,
        "info",
      );
    },
    intermediateSteps,
    // Final compaction: after the 8th pass writes the last concern, compact
    // before the orchestrator transitions to the human-in-the-loop
    // Review Concerns gate. Satisfies PRD §11 rule 6.
    finalCompactInstructions: `Summarise only: all ${REVIEW_PASSES.length} review passes complete. Concerns written to ${reviewFilePath}. Preserve the count of non-empty concern sections and the highest severity seen. The orchestrator will read the concerns file and prompt the user.`,
  }).then(async (result) => {
    if (!result.cancelled && options.onComplete) {
      await options.onComplete(state);
    }
    return result;
  });
}