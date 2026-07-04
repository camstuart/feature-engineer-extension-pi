/**
 * Implementation Planning skill prompt builder.
 */

import type { FeatureState } from "../state.js";
import {
  codeBlock,
  exampleBlock,
  existingArtifactBlock,
  interactiveApprovalReminder,
  revisionFeedbackBlock,
  skillHeader,
  templatePopulationReminder,
} from "./common.js";

export interface ImplPlanningPromptInputs {
  template: string;
  requirement: string;
  architecture: string;
  testPlan: string;
  structure: string;
  qaEngineering: string;
  gitStrategy: string;
  existingImplPlan: string | null;
  state: FeatureState;
  rejectionFeedback: string | null;
  outputPath: string;
}

export function buildImplPlanningPrompt(inputs: ImplPlanningPromptInputs): string {
  const {
    template,
    requirement,
    architecture,
    testPlan,
    structure,
    qaEngineering,
    gitStrategy,
    existingImplPlan,
    state,
    rejectionFeedback,
    outputPath,
  } = inputs;
  const isExisting = existingImplPlan !== null;

  const lines: string[] = [
    skillHeader(state, "Implementation Planning"),
    "",
    isExisting
      ? `This is a **modification** of an existing feature. The prior \`05-technical-plan-implementation.md\` is the baseline.`
      : `This is a **new feature**. Generate the implementation plan from scratch.`,
    "",
    "## Output Path",
    `Write the final document to: \`${outputPath}\``,
    "",
    "## Input Files",
    ...codeBlock("01-requirement.md", requirement),
    ...codeBlock("03-technical-architecture.md", architecture),
    ...codeBlock("04-technical-plan-testing.md", testPlan),
    ...codeBlock("02-structure.md", structure),
    ...codeBlock("05-qa-engineering.md", qaEngineering),
    ...codeBlock("06-git-strategy.md", gitStrategy),
    ...existingArtifactBlock("Existing 05-technical-plan-implementation.md (baseline)", existingImplPlan),
    ...revisionFeedbackBlock(rejectionFeedback),
    "",
    "## Output Template",
    "Use this template for the final `05-technical-plan-implementation.md`. Each task block must be separated by a `---` horizontal rule as shown.",
    ...codeBlock("Template: 05-technical-plan-implementation.md", template),
    "",
    "## Worked Example (one task, fully populated)",
    "Use this as a guide for the level of detail expected in each task:",
    ...exampleBlock(
      "Task",
      [
        "### Task 3: Implement `parseJwtExpiry`",
        "**Target file(s):** `src/auth/parse-jwt-expiry.ts`",
        "**Satisfies tests:** `it(\"should throw TokenExpiredError when the exp claim is in the past\")`, `it(\"should throw MalformedTokenError when the exp claim is not a number\")`",
        "**Description:** Parse a JWT's `exp` claim as a `Date`, throwing `TokenExpiredError` for past timestamps and `MalformedTokenError` for non-numeric claims. Pure function, no I/O. Reuse `src/errors.ts::TokenExpiredError` and `MalformedTokenError`.",
        "",
        "---",
      ].join("\n"),
      "Concrete file path, exact test names from the test plan, one-sentence description. Each task must look this specific.",
    ),
    ...templatePopulationReminder(),
    "",
    "---",
    "",
    "**Process**",
    "",
    "1. Walk through the test plan, architecture, and structure to enumerate every discrete task required to implement the feature.",
    "2. Order tasks by dependency: data layer → service layer → API → UI. Each task should be completable and verifiable in isolation.",
    "3. For each task, fill in the template fields: title, target file(s), tests it satisfies, description. The `Satisfies tests` line must use the exact `it(\"...\")` strings from the test plan.",
    "4. Mark commit boundaries per `06-git-strategy.md`. Use `[CHECKPOINT]` to mark a task as a commit boundary, or `[INLINE]` to mark it as part of the previous commit's group. Place the marker at the end of the task description.",
    "5. Identify commit checkpoints per `06-git-strategy.md` in the `## Commit Checkpoints` section.",
    "6. For the `## Rollback Notes` section: if no tasks are risky or irreversible, omit the section entirely. Otherwise, list each risky task and the undo steps.",
    "7. Write the document to the output path and run the self-check in the approval-gate reminder.",
    "",
    ...interactiveApprovalReminder("Implementation plan approved"),
  ];

  return lines.join("\n");
}