import { describe, expect, it } from "vitest";
import { buildTestPlanningPrompt } from "@/prompts/test-planning";

const TEMPLATE = "# Test Plan\n<!-- AI: ... -->";
const REQUIREMENT = "Requirement";
const ARCH = "Architecture";
const STRUCTURE = "Structure";
const TECH = "Tech";
const QA_STATIC = "QA Static";
const QA_ENG = "QA Engineering";

const BASE_STATE = {
  featureId: 1,
  featureSlug: "x",
  featureDir: "/x",
  step: "test-planning" as const,
};

describe("prompts/test-planning", () => {
  it("inlines all input files and the template", () => {
    const prompt = buildTestPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      qaEngineering: QA_ENG,
      existingTestPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-testing.md",
    });

    expect(prompt).toContain("# Testing and QA Planning");
    expect(prompt).toContain(REQUIREMENT);
    expect(prompt).toContain(ARCH);
    expect(prompt).toContain(STRUCTURE);
    expect(prompt).toContain(TECH);
    expect(prompt).toContain(QA_STATIC);
    expect(prompt).toContain(QA_ENG);
    expect(prompt).toContain(TEMPLATE);
    expect(prompt).toContain("/x/technical-plan-testing.md");
  });

  it("includes existing test plan for modifications", () => {
    const existing = "Old test plan";
    const prompt = buildTestPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      qaEngineering: QA_ENG,
      existingTestPlan: existing,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-testing.md",
    });

    expect(prompt).toContain(existing);
    expect(prompt).toMatch(/modification/i);
  });

  it("includes rejection feedback when present", () => {
    const prompt = buildTestPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      qaEngineering: QA_ENG,
      existingTestPlan: null,
      state: BASE_STATE,
      rejectionFeedback: "missing integration tests",
      outputPath: "/x/technical-plan-testing.md",
    });

    expect(prompt).toContain("Revision Feedback");
    expect(prompt).toContain("missing integration tests");
  });

  it("uses the new approval gate reminder (self-check, /feature approve, no ui.confirm)", () => {
    const prompt = buildTestPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      qaEngineering: QA_ENG,
      existingTestPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-testing.md",
    });

    expect(prompt).toMatch(/Self-check/i);
    expect(prompt).toMatch(/\/feature approve/);
    expect(prompt).not.toMatch(/ui\.confirm/);
  });

  it("includes a worked example for one test case", () => {
    const prompt = buildTestPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      qaEngineering: QA_ENG,
      existingTestPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-testing.md",
    });

    expect(prompt).toContain("## Example — Unit Test");
  });

  it("instructs the LLM to use stable it() strings", () => {
    const prompt = buildTestPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      structure: STRUCTURE,
      techStack: TECH,
      qaStaticTools: QA_STATIC,
      qaEngineering: QA_ENG,
      existingTestPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-testing.md",
    });

    expect(prompt).toMatch(/stable.*it\(/i);
  });
});
