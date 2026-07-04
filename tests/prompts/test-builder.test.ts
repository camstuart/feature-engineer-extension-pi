import { describe, expect, it } from "vitest";
import { buildTestBuilderPrompt } from "@/prompts/test-builder";

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
