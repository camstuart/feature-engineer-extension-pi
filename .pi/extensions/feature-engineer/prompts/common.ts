/**
 * Common prompt-building helpers used across all skill prompts.
 */

import type { FeatureState } from "../state.js";
import { padId } from "../paths.js";

/** Renders the standard skill header (used at the top of every prompt). */
export function skillHeader(state: FeatureState, skillLabel: string): string {
  return `# ${skillLabel} — Feature ${padId(state.featureId)}: ${state.featureSlug}`;
}

/**
 * Wraps a piece of content in a labelled `markdown` fenced block.
 * Empty content becomes an empty block, not "undefined".
 */
export function codeBlock(label: string, content: string): string[] {
  return ["", `## ${label}`, "", "```markdown", content.trim(), "```"];
}

/**
 * Renders a small worked example of a populated section, used inside prompts
 * to anchor the LLM on what "good" output looks like. The example is shown
 * as a labelled code block followed by a one-line "what this demonstrates"
 * note.
 */
export function exampleBlock(label: string, content: string, note: string): string[] {
  return [
    "",
    `## Example — ${label}`,
    "",
    "```markdown",
    content.trim(),
    "```",
    "",
    `*${note}*`,
  ];
}

/**
 * Reminds the LLM to fully populate the supplied template before declaring
 * done. Templates ship with `{{placeholder}}` markers and `<!-- AI: ... -->`
 * guidance comments; both must be replaced/removed in the final output.
 */
export function templatePopulationReminder(): string[] {
  return [
    "",
    "**Template Population Reminder**",
    "",
    "Replace every `{{placeholder}}` marker and remove every `<!-- AI: ... -->` comment before finishing — the orchestrator validates this deterministically on `/feature approve` and will block advancement if either remains.",
  ];
}

/**
 * Standard approval-gate reminder. Note that the LLM does NOT call
 * `ui.confirm` itself — the user reviews the artifact, then types
 * `/feature approve` (orchestrator advances) or `/feature reject <feedback>`
 * (orchestrator re-prompts with feedback).
 */
export function interactiveApprovalReminder(skillLabel: string): string[] {
  void skillLabel; // Reserved for future use; kept for stable call sites.
  return [
    "",
    "**Approval Gate**",
    "",
    "When you have written the artifact:",
    "",
    "1. Write a clean, complete document — no placeholder filler, no truncation.",
    "2. Tell the user the output path and the section headings you populated.",
    "3. End your turn. Do not call any further tools.",
    "",
    "The orchestrator validates the artifact automatically when the user runs `/feature approve` (no leftover placeholders/AI comments, all template headings present) — you do not need to self-verify this manually, but write a clean, complete document the first time.",
    "",
    "**User workflow:**",
    "",
    "- On approve: the user types `/feature approve` to advance to the next step.",
    `- On reject: the user types \`/feature reject <feedback>\` — their feedback is passed back to you on the next attempt.`,
    "",
    `If the user typed \`/feature reject\`, treat the previous artifact as a draft. Address every point of feedback in the new draft.`,
  ];
}

/** Renders the automated-skill reminder (no approval gate). */
export function automatedSkillReminder(): string[] {
  return [
    "",
    "**Automation Notes**",
    "",
    "This is an automated skill — there is no interactive approval gate. After writing the artifact, the extension will automatically advance to the next step.",
  ];
}

/** Renders the revision-feedback block when present. */
export function revisionFeedbackBlock(feedback: string | null | undefined): string[] {
  if (!feedback || feedback.trim().length === 0) return [];
  return ["", "## Revision Feedback", "", feedback.trim()];
}

/** Renders the review-concerns block when present (from a MINOR/ARCH severity-gate routing). */
export function reviewConcernsBlock(concerns: string | null | undefined): string[] {
  if (!concerns || concerns.trim().length === 0) return [];
  return ["", "## Review Concerns To Address", "", concerns.trim()];
}

/** Renders the existing-artifact block when present. */
export function existingArtifactBlock(label: string, content: string | null): string[] {
  if (content === null) return [];
  return codeBlock(label, content);
}