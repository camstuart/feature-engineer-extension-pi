import { describe, expect, it } from "vitest";
import { buildTestBuilderPrompt, buildTestBuilderRetryPrompt } from "@/prompts/test-builder";

const ARCH = "Architecture content";
const TEST_PLAN = "Test plan content";
const IMPL_PLAN = "Implementation plan content";
const STRUCTURE = "Structure content";
const TECH = "Tech stack content";
const QA_STATIC = "QA static tools content";

const BASE_STATE = {
  featureId: 1,
  featureSlug: "x",
  featureDir: "/x",
  step: "test-builder" as const,
};

describe("prompts/test-builder", () => {
  it("inlines all input files", () => {
    const prompt = buildTestBuilderPrompt({
      architecture: ARCH,
      testPlan: TEST_PLAN,
      implPlan: IMPL_PLAN,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      state: BASE_STATE,
    });

    expect(prompt).toContain("# Test Builder");
    expect(prompt).toContain(ARCH);
    expect(prompt).toContain(TEST_PLAN);
    expect(prompt).toContain(IMPL_PLAN);
    expect(prompt).toContain(STRUCTURE);
    expect(prompt).toContain(TECH);
    expect(prompt).toContain(QA_STATIC);
  });

  it("instructs the agent to write failing tests (red phase TDD)", () => {
    const prompt = buildTestBuilderPrompt({
      architecture: ARCH,
      testPlan: TEST_PLAN,
      implPlan: IMPL_PLAN,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      state: BASE_STATE,
    });

    expect(prompt).toMatch(/red phase/i);
    expect(prompt).toMatch(/fail/i);
  });

  it("requires syntax validation after writing", () => {
    const prompt = buildTestBuilderPrompt({
      architecture: ARCH,
      testPlan: TEST_PLAN,
      implPlan: IMPL_PLAN,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      state: BASE_STATE,
    });

    expect(prompt).toMatch(/syntax|validate/i);
  });

  it("verifies tests fail (not just parse) and explains why", () => {
    const prompt = buildTestBuilderPrompt({
      architecture: ARCH,
      testPlan: TEST_PLAN,
      implPlan: IMPL_PLAN,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      state: BASE_STATE,
    });

    expect(prompt).toMatch(/meaningful error/i);
    expect(prompt).toMatch(/not a function|nothing to test/i);
  });

  it("includes a worked example for one test file", () => {
    const prompt = buildTestBuilderPrompt({
      architecture: ARCH,
      testPlan: TEST_PLAN,
      implPlan: IMPL_PLAN,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      state: BASE_STATE,
    });

    expect(prompt).toContain("## Example — Test File");
  });

  it("uses the automated skill reminder (no approval gate)", () => {
    const prompt = buildTestBuilderPrompt({
      architecture: ARCH,
      testPlan: TEST_PLAN,
      implPlan: IMPL_PLAN,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      state: BASE_STATE,
    });

    expect(prompt).toMatch(/automated skill/i);
    expect(prompt).not.toMatch(/Architecture approved/i);
  });
});

describe("prompts/test-builder — buildTestBuilderRetryPrompt", () => {
  const FAILURE_FEEDBACK = "QA tools failed (1):\n\n### tsc --noEmit\n\n```\nsome type error\n```\n";

  it("explains the typecheck-failed violation and instructs fixing the test file only", () => {
    const prompt = buildTestBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 2,
      maxAttempts: 2,
      violation: "typecheck-failed",
      failureFeedback: FAILURE_FEEDBACK,
      implPlan: IMPL_PLAN,
    });

    expect(prompt).toMatch(/type-check(er|ing)? failed/i);
    expect(prompt).toContain(FAILURE_FEEDBACK);
    expect(prompt).toContain(IMPL_PLAN);
    expect(prompt).toMatch(/do not touch production code/i);
  });

  it("explains the tests-passed violation and instructs rewriting the test to fail meaningfully", () => {
    const prompt = buildTestBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 1,
      maxAttempts: 2,
      violation: "tests-passed",
      failureFeedback: FAILURE_FEEDBACK,
      implPlan: IMPL_PLAN,
    });

    expect(prompt).toMatch(/passed.*mistake|wrote real production code by mistake/i);
    expect(prompt).toMatch(/meaningful runtime error/i);
    expect(prompt).toMatch(/do not add or edit any production code/i);
  });

  it("marks the final attempt distinctly from earlier attempts", () => {
    const finalPrompt = buildTestBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 2,
      maxAttempts: 2,
      violation: "typecheck-failed",
      failureFeedback: FAILURE_FEEDBACK,
      implPlan: IMPL_PLAN,
    });
    const nonFinalPrompt = buildTestBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 1,
      maxAttempts: 2,
      violation: "typecheck-failed",
      failureFeedback: FAILURE_FEEDBACK,
      implPlan: IMPL_PLAN,
    });

    expect(finalPrompt).toMatch(/FINAL/);
    expect(nonFinalPrompt).not.toMatch(/FINAL/);
  });

  it("includes the retry header naming the attempt count", () => {
    const prompt = buildTestBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 1,
      maxAttempts: 2,
      violation: "typecheck-failed",
      failureFeedback: FAILURE_FEEDBACK,
      implPlan: IMPL_PLAN,
    });
    expect(prompt).toContain("Retry 1/2");
  });
});
