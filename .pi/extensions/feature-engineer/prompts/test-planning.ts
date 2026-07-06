/**
 * Testing and QA Planning skill prompt builder.
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

export interface TestPlanningPromptInputs {
  template: string;
  requirement: string;
  architecture: string;
  structure: string;
  techStack: string;
  qaStaticTools: string;
  qaEngineering: string;
  existingTestPlan: string | null;
  state: FeatureState;
  rejectionFeedback: string | null;
  outputPath: string;
}

export function buildTestPlanningPrompt(inputs: TestPlanningPromptInputs): string {
  const {
    template,
    requirement,
    architecture,
    structure,
    techStack,
    qaStaticTools,
    qaEngineering,
    existingTestPlan,
    state,
    rejectionFeedback,
    outputPath,
  } = inputs;
  const isExisting = existingTestPlan !== null;

  const lines: string[] = [
    skillHeader(state, "Testing and QA Planning"),
    "",
    isExisting
      ? `This is a **modification** of an existing feature. The prior \`04-technical-plan-testing.md\` is the baseline.`
      : `This is a **new feature**. Generate the testing and QA plan from scratch.`,
    "",
    "## Output Path",
    `Write the final document to: \`${outputPath}\``,
    "",
    "## Input Files",
    ...codeBlock("01-requirement.md", requirement),
    ...codeBlock("03-technical-architecture.md", architecture),
    ...codeBlock("02-structure.md", structure),
    ...codeBlock("03-tech-stack.md", techStack),
    ...codeBlock("04-qa-static-tools.md", qaStaticTools),
    ...codeBlock("05-qa-engineering.md", qaEngineering),
    ...existingArtifactBlock("Existing 04-technical-plan-testing.md (baseline)", existingTestPlan),
    ...revisionFeedbackBlock(rejectionFeedback),
    "",
    "## Output Template",
    "Use this template for the final `04-technical-plan-testing.md`.",
    ...codeBlock("Template: 04-technical-plan-testing.md", template),
    "",
    "## Worked Example (one test case, fully populated)",
    "Use this as a guide for the level of detail expected in each test case:",
    ...exampleBlock(
      "Unit Test",
      [
        "### `parseJwtExpiry`",
        "**File:** `src/auth/__tests__/parse-jwt-expiry.test.ts`",
        "- `it(\"should return the exp claim as a Date when the token is valid\")`",
        "- `it(\"should throw TokenExpiredError when the exp claim is in the past\")`",
        "- `it(\"should throw MalformedTokenError when the exp claim is not a number\")`",
      ].join("\n"),
      "Three stable, descriptive test names. The implementation plan will reference these by their `it(\"...\")` strings.",
    ),
    ...templatePopulationReminder(),
    "",
    "---",
    "",
    "**Process**",
    "",
    "1. Walk through the requirement and architecture to enumerate every component, function, or boundary that needs a test.",
    "2. For each, write one or more test cases. Use **stable, descriptive `it(\"should ...\")` strings** — these will be cross-referenced by the implementation plan and the code itself.",
    "3. Write the document to the output path. Run the self-check in the approval-gate reminder.",
    "4. Present the output path and a 3-5 bullet summary of the coverage decisions you made.",
    "",
    ...interactiveApprovalReminder("Test plan approved"),
  ];

  return lines.join("\n");
}