/**
 * Review Completion skill prompt builder.
 *
 * The orchestrator runs 5 sequential LLM review passes with deterministic
 * compaction between them, followed by the orchestrator's own deterministic
 * git-strategy checks (branch naming, commit conventions — no LLM pass).
 * Each LLM pass:
 *   1. Reviews a specific area of the implementation
 *   2. Appends concerns to `06-review-concerns-to-address.md` under a fixed
 *      section heading
 *   3. Ends its turn — the runner compacts context and starts the next pass
 *
 * The orchestrator (not the LLM) decides the next workflow step: a clean
 * concerns file auto-advances to the GitHub step, while any concerns route
 * the user to a gate with a recommended severity (ARCH if any `[ARCH]`
 * concern is present, otherwise MINOR).
 */

import type { FeatureState } from "../state.js";
import {
  codeBlock,
  skillHeader,
  templatePopulationReminder,
} from "./common.js";

export type ReviewPassId =
  | "requirements-coverage"
  | "file-structure"
  | "tech-stack"
  | "engineering-principles"
  | "architecture-conformance";

export interface ReviewPass {
  id: ReviewPassId;
  label: string;
  /** Files (relative to the feature dir or `.feature-engineer/`) the pass reviews. */
  files: readonly string[];
  /** Question / framing for the LLM. */
  question: string;
  /** Specific instructions for what to check and where to write concerns. */
  instructions: string;
}

export const REVIEW_PASSES: readonly ReviewPass[] = [
  {
    id: "requirements-coverage",
    label: "Requirements Coverage",
    files: ["01-requirement.md", "01-actors.md"],
    question:
      "Is every functional and non-functional requirement in 01-requirement.md satisfied by the implementation, AND does the implementation cover every user story for every actor in 01-actors.md, broken down correctly per actor? Are any requirements, actors, or stories missing or under-implemented?",
    instructions:
      "Enumerate every numbered requirement in 01-requirement.md and verify each is satisfied by a test or concrete code path. Separately, cross-reference each actor in 01-actors.md against its user stories and the implementation surface (test plan, architecture, code) to confirm every actor's stories are covered. Note any gap — whether a missing requirement, actor, or story — in the concerns file under the `## Requirements Coverage` heading.",
  },
  {
    id: "file-structure",
    label: "File Structure",
    files: ["02-structure.md", "03-technical-architecture.md"],
    question:
      "Are new and modified files placed correctly per the project's 02-structure.md? Are any files in unexpected locations or missing where they should be?",
    instructions:
      "Walk every new file referenced in the implementation and architecture docs. Verify each lives at a path consistent with 02-structure.md. List misplaced or missing files under `## File Structure`.",
  },
  {
    id: "tech-stack",
    label: "Tech Stack Compliance",
    files: ["03-tech-stack.md"],
    question:
      "Does the implementation use only the libraries and frameworks documented in 03-tech-stack.md? Are any undeclared dependencies introduced?",
    instructions:
      "Inspect dependencies in package manifests (or equivalent) and imports in the new code. Flag any library not listed in 03-tech-stack.md under `## Tech Stack Compliance`.",
  },
  {
    id: "engineering-principles",
    label: "Engineering Principles",
    files: ["05-qa-engineering.md"],
    question:
      "Does the code follow the engineering principles in 05-qa-engineering.md (reuse, naming, error handling, etc.)? Any clear violations?",
    instructions:
      "Sample several new files and check each principle listed in 05-qa-engineering.md. Document any concrete violations under `## Engineering Principles`.",
  },
  {
    id: "architecture-conformance",
    label: "Architecture Conformance",
    files: ["03-technical-architecture.md"],
    question:
      "Does the final code match the components, data structures, and patterns described in 03-technical-architecture.md?",
    instructions:
      "Verify each named component in 03-technical-architecture.md exists in the code, with the agreed interface. Note divergences under `## Architecture Conformance`.",
  },
];

export interface ReviewPassPromptInputs {
  pass: ReviewPass;
  /** Map of filename → file contents for the files this pass reviews. */
  fileContents: Readonly<Record<string, string>>;
  /**
   * Current content of `06-review-concerns-to-address.md` from prior passes
   * (null for the first pass, since the file does not exist yet). Shown
   * as background context so the LLM can build on prior findings.
   */
  priorConcerns: string | null;
  state: FeatureState;
  reviewConcernsPath: string;
  template: string;
}

export function buildReviewPassPrompt(inputs: ReviewPassPromptInputs): string {
  const { pass, fileContents, priorConcerns, state, reviewConcernsPath, template } = inputs;

  const lines: string[] = [
    skillHeader(state, `Review — ${pass.label}`),
    "",
    `**Review area:** ${pass.id}`,
    "",
    `## Question`,
    "",
    pass.question,
    "",
    "## Instructions",
    "",
    pass.instructions,
    "",
    "## Files To Review",
    ...pass.files.flatMap((f) => fileBlock(f, fileContents[f] ?? null)),
    ...priorConcernsBlock(priorConcerns),
    "",
    "## Output Template",
    "Append any concerns you find under the matching heading in `06-review-concerns-to-address.md`, using the format below. Do not delete the heading.",
    ...codeBlock("Template: 06-review-concerns-to-address.md", template),
    ...templatePopulationReminder(),
    "",
    "## Output Path",
    `Append your concerns to: \`${reviewConcernsPath}\``,
    "",
    "## Concern Format",
    "",
    "Format each concern as a markdown bullet:",
    "",
    "```",
    "- [ARCH|MINOR] <one-sentence observation> → <one-sentence suggested fix>",
    "```",
    "",
    "Where the tag is either `ARCH` or `MINOR`:",
    "",
    "- `ARCH` — an architectural or structural problem that requires returning to technical design (e.g. a component boundary is wrong, a chosen data structure can't satisfy the requirement, a pattern from 03-technical-architecture.md was fundamentally not followed).",
    "- `MINOR` — an issue that can be fixed directly in the implementation without revisiting the design (e.g. a missing edge case, a naming inconsistency, an incomplete test).",
    "",
    "If you find no concerns in this area, append a single line:",
    "",
    "```",
    "- No concerns.",
    "```",
    "",
    "## Process",
    "",
    `1. Review the files listed above against the question and instructions.`,
    `2. Read the current state of the concerns file (if shown above) to see what prior passes have flagged.`,
    `3. Append concrete concerns to \`${reviewConcernsPath}\` under the heading \`## ${pass.label}\` using the format above.`,
    `4. End your turn. The orchestrator will compact context and start the next pass.`,
    "",
    "## What Happens Next",
    "",
    "The orchestrator runs all 5 LLM review passes, then its own deterministic git-strategy checks (branch naming, commit conventions) directly into the `## Git Strategy` heading — no LLM pass handles that. After that, the orchestrator reads `06-review-concerns-to-address.md` itself:",
    "",
    "- If every heading contains only `- No concerns.`, the review is clean and the workflow auto-advances to the GitHub step with a notification — no user action needed.",
    "- If any heading has a concrete concern, the workflow stops at a user gate showing the concern count and a recommended route: ARCHITECTURAL if any `[ARCH]` concern is present, otherwise MINOR. The user picks ARCHITECTURAL (back to tech-design) or MINOR (back to impl-builder), and that skill is given the outstanding concerns to address.",
  ];

  return lines.join("\n");
}

function fileBlock(filename: string, content: string | null): string[] {
  if (content === null || content.trim().length === 0) {
    return ["", `- **${filename}**: _(missing or empty)_`];
  }
  return codeBlock(filename, content);
}

function priorConcernsBlock(content: string | null): string[] {
  if (content === null || content.trim().length === 0) return [];
  return [
    "",
    "## Prior Review Concerns (from earlier passes)",
    "Cross-reference these — do not duplicate, but build on them if relevant.",
    ...codeBlock("06-review-concerns-to-address.md (current state)", content),
  ];
}