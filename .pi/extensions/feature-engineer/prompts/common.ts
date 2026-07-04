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
    "The output template contains authoring scaffolding that must be removed from the final file:",
    "",
    "- Replace every `{{placeholder}}` marker with concrete content. The placeholders are authoring aids, not literal text to keep.",
    "- Remove every `<!-- AI: ... -->` comment line once you have used the guidance it provides.",
    "- Every section header from the template must appear in the output, with content specific to this feature. Do not leave any section blank or filled with placeholder filler.",
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
    "1. Run the self-check below. Fix any failures before continuing.",
    "2. Tell the user the output path and the section headings you populated.",
    "3. End your turn. Do not call any further tools.",
    "",
    "**Self-check before declaring done:**",
    "",
    "- Every section header from the template is present in the output.",
    "- No `{{placeholder}}` markers and no `<!-- AI: ... -->` comments remain.",
    "- Every section has content specific to this feature (no placeholder filler or `TBD` notes).",
    "- The file is readable end-to-end with no truncation.",
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

/** Renders the existing-artifact block when present. */
export function existingArtifactBlock(label: string, content: string | null): string[] {
  if (content === null) return [];
  return codeBlock(label, content);
}