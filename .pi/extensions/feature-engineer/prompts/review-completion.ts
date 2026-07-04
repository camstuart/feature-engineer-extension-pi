/**
 * Review Completion skill prompt builder.
 *
 * The orchestrator runs 8 sequential review passes with deterministic
 * compaction between them. Each pass:
 *   1. Reviews a specific area of the implementation
 *   2. Appends concerns to `06-review-concerns-to-address.md` under a fixed
 *      section heading
 *   3. Ends its turn — the runner compacts context and starts the next pass
 *
 * The orchestrator (not the LLM) decides the next workflow step based on
 * whether the concerns file is empty after all 8 passes.
 */

import type { FeatureState } from "../state.js";
import {
  codeBlock,
  skillHeader,
  templatePopulationReminder,
} from "./common.js";

export type ReviewPassId =
  | "actors-coverage"
  | "file-structure"
  | "tech-stack"
  | "static-qa"
  | "engineering-principles"
  | "git-strategy"
  | "requirements-coverage"
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
    id: "actors-coverage",
    label: "Actors Coverage",
    files: ["01-actors.md", "01-requirement.md"],
    question:
      "Does the implementation cover every user story in the requirement, broken down correctly for each actor in 01-actors.md? Are any actors or stories missing?",
    instructions:
      "Cross-reference each user story in 01-requirement.md against the implementation surface (test plan, architecture, code). List any actor or story that is missing or under-implemented in the concerns file under the `## Actors Coverage` heading.",
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
    id: "static-qa",
    label: "Static QA",
    files: ["04-qa-static-tools.md"],
    question:
      "Did the Implementation Builder run every static QA tool listed in 04-qa-static-tools.md, and did each pass? Is the coverage threshold met?",
    instructions:
      "Cross-reference the QA commands in 04-qa-static-tools.md against the implementation results. Note any tools that failed or thresholds that fell short under `## Static QA`.",
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
    id: "git-strategy",
    label: "Git Strategy",
    files: ["06-git-strategy.md"],
    question:
      "Were commits made per the 06-git-strategy.md conventions (branch naming, commit message format, frequency, PR labels)?",
    instructions:
      "Inspect the recent git history. Compare branch names, commit messages, and grouping against 06-git-strategy.md. Flag deviations under `## Git Strategy`.",
  },
  {
    id: "requirements-coverage",
    label: "Requirements Coverage",
    files: ["01-requirement.md"],
    question:
      "Is every functional and non-functional requirement in 01-requirement.md satisfied by the implementation?",
    instructions:
      "Enumerate every numbered requirement. Verify each is satisfied by a test or concrete code path. Note any gap under `## Requirements Coverage`.",
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
    "Append any concerns you find under the matching heading in `06-review-concerns-to-address.md`. Leave a heading's body empty (no text) if you find no concerns in that area — do not delete the heading.",
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
    "- [<severity>] <one-sentence observation> → <one-sentence suggested fix>",
    "```",
    "",
    "Where `<severity>` is one of `BLOCKER`, `MAJOR`, `MINOR`, or `NIT`. Use `BLOCKER` sparingly — only for issues that prevent the workflow from advancing (e.g. a missing test, a broken build, an unrecoverable error).",
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
    "The orchestrator will run all 8 review passes. After the last pass, the orchestrator reads `06-review-concerns-to-address.md` itself:",
    "",
    "- If every heading is empty (or contains only `- No concerns.`), the workflow advances to the GitHub step.",
    "- If any heading has a concrete concern, the workflow asks the user to choose a severity (ARCHITECTURAL or MINOR) and re-runs the appropriate earlier phase.",
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