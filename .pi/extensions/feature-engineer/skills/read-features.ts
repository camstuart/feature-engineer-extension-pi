/**
 * Read Features — separate skill module.
 *
 * When the user picks EXISTING at the New/Existing gate, this module
 * handles the feature selection. The selection data is just a directory
 * listing plus the first line of each existing requirement.md — no LLM
 * work is needed, so the operation runs inline via `ctx.ui.select` rather
 * than spinning up a fresh Pi session. This is the efficient form the
 * orchestrator uses; the PRD describes the same flow as a "SKILL" for
 * naming consistency with the other workflow steps, but no new session
 * is created.
 *
 * Keeping the logic in its own module (rather than inline in
 * `handleNewOrExisting`) makes it independently testable and lets the
 * `handleNewOrExisting` orchestrator stay focused on the NEW-vs-EXISTING
 * branching.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { listExistingFeatures, type ExistingFeatureSummary } from "../files.js";

export interface ReadFeaturesResult {
  /** The selected feature's id and slug. */
  picked: ExistingFeatureSummary;
}

/**
 * Prompts the user to pick one of the existing features. Returns the
 * selection, or `null` if the user cancels or there are no features.
 *
 * The returned object includes the path to the feature's requirement.md
 * so the orchestrator can pre-load it as a baseline.
 */
export async function runReadFeatures(
  ctx: ExtensionCommandContext,
): Promise<ReadFeaturesResult | null> {
  if (!ctx.hasUI) {
    ctx.ui.notify(
      "Feature Engineer: Read Features requires interactive mode (TUI or RPC) to select an existing feature.",
      "warning",
    );
    return null;
  }

  const existing = listExistingFeatures(ctx.cwd);
  if (existing.length === 0) {
    ctx.ui.notify(
      "No existing features found. Run /feature and choose New feature instead.",
      "warning",
    );
    return null;
  }

  const labels = existing.map((f) => `${formatId(f.id)} — ${f.slug}`);
  const choiceLabel = await ctx.ui.select("Which feature?", labels);
  if (choiceLabel === undefined) {
    ctx.ui.notify("Feature Engineer: feature selection cancelled.", "info");
    return null;
  }

  const idx = labels.indexOf(choiceLabel);
  if (idx < 0) {
    ctx.ui.notify("Feature Engineer: feature selection mismatch — please retry.", "error");
    return null;
  }

  const picked = existing[idx]!;
  return { picked };
}

function formatId(id: number): string {
  return String(id).padStart(3, "0");
}
