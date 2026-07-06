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

export interface TestBuilderRetryPromptInputs {
  state: FeatureState;
  attempt: number;
  maxAttempts: number;
  /**
   * Which red-phase invariant the orchestrator's deterministic check
   * (`checkRedPhase` in `qa.ts`) found violated on the previous attempt.
   */
  violation: "typecheck-failed" | "tests-passed";
  /** The failing command and its output, pre-formatted (e.g. via `formatFailureFeedback`). */
  failureFeedback: string;
  implPlan: string;
}

export function buildTestBuilderRetryPrompt(inputs: TestBuilderRetryPromptInputs): string {
  const { state, attempt, maxAttempts, violation, failureFeedback, implPlan } = inputs;
  const isFinal = attempt === maxAttempts;

  const violationExplanation =
    violation === "typecheck-failed"
      ? "The type-checker failed on the test files you wrote. Test files must parse and type-check cleanly — a type error is not a legitimate red-phase failure, it means something is broken in the test file itself (bad import path, wrong signature, syntax error, etc.)."
      : "The test runner reported a clean pass (exit code 0). Tests must fail with a meaningful error until the Implementation Builder writes the matching production code — a passing suite here means you wrote real production code by mistake, or a vacuous test that asserts nothing (e.g. missing `expect(...)`, an empty test body, or a test that doesn't exercise the untested code path).";

  const fixInstruction =
    violation === "typecheck-failed"
      ? "Fix the type error(s) directly in the test file(s) — do not touch production code, and do not weaken the test to work around the error."
      : "Find the test(s) that passed and rewrite them so they genuinely exercise the not-yet-implemented behaviour and fail with a meaningful runtime error (e.g. `<symbol> is not a function`, not a parse/import error). Do not add or edit any production code to make a test fail.";

  const lines: string[] = [
    skillHeader(state, `Test Builder — Retry ${attempt}/${maxAttempts}`),
    "",
    `Attempt ${attempt} of ${maxAttempts}${isFinal ? " (FINAL — no further retries)" : ""}.`,
    "",
    "The orchestrator's deterministic red-phase check found a violation in your previous attempt:",
    "",
    violationExplanation,
    "",
    "## Observed Outcome",
    "",
    "```",
    failureFeedback,
    "```",
    "",
    "## Implementation Plan (context)",
    "",
    "Re-read this to confirm which symbols are not implemented yet.",
    ...codeBlock("05-technical-plan-implementation.md", implPlan),
    "",
    "## Process",
    "",
    fixInstruction,
    "",
    "Then re-run both the type-checker and the test runner yourself as a sanity check before ending your turn.",
    "",
    "When complete, end your turn with a one-sentence summary: which test files you changed and why.",
  ];

  return lines.join("\n");
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