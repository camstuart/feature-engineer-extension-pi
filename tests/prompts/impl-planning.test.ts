import { describe, expect, it } from "vitest";
import { buildImplPlanningPrompt } from "@/prompts/impl-planning";

const TEMPLATE = "# Implementation Plan\n<!-- AI: ... -->";
const REQUIREMENT = "Requirement";
const ARCH = "Architecture";
const TEST_PLAN = "Test plan";
const STRUCTURE = "Structure";
const QA_ENG = "QA Engineering";
const GIT_STRATEGY = "Git Strategy";

const BASE_STATE = {
  featureId: 1,
  featureSlug: "x",
  featureDir: "/x",
  step: "impl-planning" as const,
};

describe("prompts/impl-planning", () => {
  it("inlines all input files and template", () => {
    const prompt = buildImplPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      testPlan: TEST_PLAN,
      structure: STRUCTURE,
      qaEngineering: QA_ENG,
      gitStrategy: GIT_STRATEGY,
      existingImplPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-implementation.md",
    });

    expect(prompt).toContain("# Implementation Planning");
    expect(prompt).toContain(REQUIREMENT);
    expect(prompt).toContain(ARCH);
    expect(prompt).toContain(TEST_PLAN);
    expect(prompt).toContain(STRUCTURE);
    expect(prompt).toContain(QA_ENG);
    expect(prompt).toContain(GIT_STRATEGY);
    expect(prompt).toContain(TEMPLATE);
    expect(prompt).toContain("/x/technical-plan-implementation.md");
  });

  it("includes existing plan for modifications", () => {
    const existing = "Old impl plan";
    const prompt = buildImplPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      testPlan: TEST_PLAN,
      structure: STRUCTURE,
      qaEngineering: QA_ENG,
      gitStrategy: GIT_STRATEGY,
      existingImplPlan: existing,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-implementation.md",
    });

    expect(prompt).toContain(existing);
    expect(prompt).toMatch(/modification/i);
  });

  it("includes rejection feedback when present", () => {
    const prompt = buildImplPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      testPlan: TEST_PLAN,
      structure: STRUCTURE,
      qaEngineering: QA_ENG,
      gitStrategy: GIT_STRATEGY,
      existingImplPlan: null,
      state: BASE_STATE,
      rejectionFeedback: "reorder tasks",
      outputPath: "/x/technical-plan-implementation.md",
    });

    expect(prompt).toContain("Revision Feedback");
    expect(prompt).toContain("reorder tasks");
  });

  it("uses the new approval gate reminder (no ui.confirm)", () => {
    const prompt = buildImplPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      testPlan: TEST_PLAN,
      structure: STRUCTURE,
      qaEngineering: QA_ENG,
      gitStrategy: GIT_STRATEGY,
      existingImplPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-implementation.md",
    });

    expect(prompt).toMatch(/Self-check/i);
    expect(prompt).toMatch(/\/feature approve/);
    expect(prompt).not.toMatch(/ui\.confirm/);
  });

  it("includes a worked example for one task", () => {
    const prompt = buildImplPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      testPlan: TEST_PLAN,
      structure: STRUCTURE,
      qaEngineering: QA_ENG,
      gitStrategy: GIT_STRATEGY,
      existingImplPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-implementation.md",
    });

    expect(prompt).toContain("## Example — Task");
  });

  it("specifies the exact it() format for the Satisfies tests line", () => {
    const prompt = buildImplPlanningPrompt({
      template: TEMPLATE,
      requirement: REQUIREMENT,
      architecture: ARCH,
      testPlan: TEST_PLAN,
      structure: STRUCTURE,
      qaEngineering: QA_ENG,
      gitStrategy: GIT_STRATEGY,
      existingImplPlan: null,
      state: BASE_STATE,
      rejectionFeedback: null,
      outputPath: "/x/technical-plan-implementation.md",
    });

    expect(prompt).toMatch(/Satisfies tests.*it\(/i);
  });
});
