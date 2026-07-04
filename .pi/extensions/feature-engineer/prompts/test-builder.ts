/**
 * Test Builder skill prompt builder.
 *
 * Automated skill: writes failing test files (red phase of TDD), then runs
 * static syntax validation. No user approval gate.
 */

import type { FeatureState } from "../state.js";
import {
  automatedSkillReminder,
  codeBlock,
  exampleBlock,
  skillHeader,
} from "./common.js";

export interface TestBuilderPromptInputs {
  architecture: string;
  testPlan: string;
  implPlan: string;
  structure: string;
  techStack: string;
  qaStaticTools: string;
  state: FeatureState;
}

export function buildTestBuilderPrompt(inputs: TestBuilderPromptInputs): string {
  const { architecture, testPlan, implPlan, structure, techStack, qaStaticTools, state } = inputs;

  const lines: string[] = [
    skillHeader(state, "Test Builder"),
    "",
    `You will write the test files for this feature. Tests must be written first, in the **red phase of TDD**: each test must fail with a meaningful error (not a parse or import error) until the Implementation Builder writes the matching production code.`,
    "",
    "## Input Files",
    ...codeBlock("03-technical-architecture.md", architecture),
    ...codeBlock("04-technical-plan-testing.md", testPlan),
    ...codeBlock("05-technical-plan-implementation.md", implPlan),
    ...codeBlock("02-structure.md", structure),
    ...codeBlock("03-tech-stack.md", techStack),
    ...codeBlock("04-qa-static-tools.md", qaStaticTools),
    "",
    "## Worked Example (one test file, fully populated)",
    "Use this as a guide for the structure of a well-formed test file:",
    ...exampleBlock(
      "Test File",
      [
        "```ts",
        "import { describe, it, expect } from \"vitest\";",
        "import { parseJwtExpiry } from \"../parse-jwt-expiry\";",
        "",
        "describe(\"parseJwtExpiry\", () => {",
        "  it(\"should throw TokenExpiredError when the exp claim is in the past\", () => {",
        "    expect(() => parseJwtExpiry({ exp: 1 })).toThrow(TokenExpiredError);",
        "  });",
        "});",
        "```",
      ].join("\n"),
      "Test imports the symbol-under-test, uses a stable `it(\"...\")` string that matches the test plan, asserts behaviour with `expect`. The import will fail until implementation exists — that is the red phase.",
    ),
    "",
    "## Process",
    "",
    "1. Walk through every test case listed in `04-technical-plan-testing.md`.",
    "2. For each, write a test file at the path specified in the test plan, following the test runner and conventions in `04-qa-static-tools.md` and `03-tech-stack.md`.",
    "3. Each test's `it(\"...\")` string must match the corresponding entry in the implementation plan's `Satisfies tests` line — verbatim. This is how the implementation plan cross-references tests.",
    "4. **Do NOT** write any production code. If you find yourself writing anything other than test setup, `import` statements, assertions, or `expect()` calls, stop and reconsider — you are crossing into implementation territory.",
    "5. After all test files are written, run the syntax/type-check command from `04-qa-static-tools.md` to confirm the files parse cleanly.",
    "6. Run the test runner. Tests must fail with a meaningful error (e.g. `parseJwtExpiry is not a function`). If a test passes, you have written production code by mistake — rewrite it as a test.",
    "",
    "## Validation Checklist",
    "",
    "- [ ] All test files parse without syntax errors.",
    "- [ ] The test runner loads all test files without crashing.",
    "- [ ] Every test fails with a meaningful error (not a parse/import error).",
    "- [ ] Every `it(\"...\")` string matches the test plan verbatim.",
    "- [ ] No production code is present in any test file.",
    "",
    ...automatedSkillReminder(),
    "",
    "When complete, end your turn with a one-sentence summary: which test files you wrote and how many test cases each contains. The extension will advance to the Implementation Builder automatically.",
  ];

  return lines.join("\n");
}