/**
 * Analyse Codebase SKILL runner.
 *
 * Interactive skill. When the user runs `/feature` and the project is not
 * yet initialised, this runner assembles the analyse-codebase prompt and
 * starts a fresh session.
 *
 * The LLM does the heavy lifting:
 *   - scans the codebase (file tree, package manifests, imports)
 *   - reads the supplied context documents (README, CLAUDE.md, AGENTS.md, PRD)
 *   - pre-fills each missing config file from its template
 *   - asks the user ONLY for gaps it genuinely cannot infer
 *   - writes the six config files to .feature-engineer/
 *
 * The user then reviews the populated files on disk, edits anything
 * they want to change, and types `/feature approve` to continue (or
 * `/feature reject <feedback>` to regenerate). The existing approval
 * gate handles that flow.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readContextFiles, readAllTemplates } from "../files.js";
import { type InitialisationStatus } from "../init.js";
import { buildAnalyseCodebasePrompt } from "../prompts/analyse-codebase.js";
import { startSkillSession } from "./runner.js";

export async function runAnalyseCodebase(
  ctx: ExtensionCommandContext,
  status: InitialisationStatus,
): Promise<{ cancelled: boolean }> {
  const cwd = ctx.cwd;
  const templates = readAllTemplates();
  const contextFiles = readContextFiles(cwd);
  const missing = status.missingConfigFiles;

  const prompt = buildAnalyseCodebasePrompt({
    templates,
    contextFiles,
    missingConfigFiles: missing,
  });

  // Use a placeholder state — this skill runs before a feature exists.
  const state = {
    featureId: 0,
    featureSlug: "init",
    featureDir: "(none — initialisation phase)",
    step: "analyse-codebase" as const,
  };

  return startSkillSession(ctx, state, prompt, {
    beforeStart: async (newCtx) => {
      newCtx.ui.notify(
        `Feature Engineer: ${missing.length} config file${missing.length === 1 ? "" : "s"} to populate. The agent will scan the codebase and pre-fill them; review the output and type /feature approve to continue.`,
        "info",
      );
    },
  });
}
