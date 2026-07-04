import { describe, expect, it } from "vitest";
import {
  buildImplBuilderPrompt,
  buildImplBuilderRetryPrompt,
} from "@/prompts/impl-builder";

const ARCH = "Architecture";
const TEST_PLAN = "Test plan";
const IMPL_PLAN = "Implementation plan";
const STRUCTURE = "Structure";
const TECH = "Tech stack";
const QA_STATIC = "QA static tools";
const QA_ENG = "QA engineering";

const BASE_STATE = {
  featureId: 1,
  featureSlug: "x",
  featureDir: "/x",
  step: "impl-builder" as const,
};

const BASE_INPUTS = {
  architecture: ARCH,
  testPlan: TEST_PLAN,
  implPlan: IMPL_PLAN,
  structure: STRUCTURE,
  techStack: TECH,
  qaStaticTools: QA_STATIC,
  qaEngineering: QA_ENG,
  state: BASE_STATE,
  maxRetries: 3,
};

describe("prompts/impl-builder", () => {
  it("inlines all input files", () => {
    const prompt = buildImplBuilderPrompt(BASE_INPUTS);
    expect(prompt).toContain("# Implementation Builder");
    expect(prompt).toContain(ARCH);
    expect(prompt).toContain(TEST_PLAN);
    expect(prompt).toContain(IMPL_PLAN);
    expect(prompt).toContain(STRUCTURE);
    expect(prompt).toContain(TECH);
    expect(prompt).toContain(QA_STATIC);
    expect(prompt).toContain(QA_ENG);
  });

  it("instructs the agent to execute tasks in order", () => {
    const prompt = buildImplBuilderPrompt(BASE_INPUTS);
    expect(prompt).toMatch(/in order/i);
    expect(prompt).toMatch(/task/i);
  });

  it("references the orchestrator's authoritative QA pass", () => {
    const prompt = buildImplBuilderPrompt(BASE_INPUTS);
    expect(prompt).toMatch(/orchestrator.*re-?prompt/i);
    expect(prompt).toMatch(/authoritative/i);
  });

  it("tells the agent to run QA tools after each task", () => {
    const prompt = buildImplBuilderPrompt(BASE_INPUTS);
    expect(prompt).toMatch(/qa/i);
    expect(prompt).toMatch(/after each task/i);
  });

  it("specifies a final structured summary message format", () => {
    const prompt = buildImplBuilderPrompt(BASE_INPUTS);
    expect(prompt).toContain("Tasks:");
    expect(prompt).toContain("Commits:");
    expect(prompt).toContain("QA:");
    expect(prompt).toMatch(/DONE \| BLOCKED/);
  });

  it("forbids force-pushes and never editing tests to pass", () => {
    const prompt = buildImplBuilderPrompt(BASE_INPUTS);
    expect(prompt).toMatch(/--force/);
    expect(prompt).toMatch(/Never edit a test file/);
  });
});

describe("prompts/impl-builder retry", () => {
  it("inlines the failure feedback and the implementation plan", () => {
    const prompt = buildImplBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 2,
      maxAttempts: 3,
      failureFeedback: "lint failed: 3 errors in foo.ts",
      implPlan: IMPL_PLAN,
    });
    expect(prompt).toContain("Implementation Builder — Retry 2/3");
    expect(prompt).toContain("lint failed: 3 errors in foo.ts");
    expect(prompt).toContain(IMPL_PLAN);
  });

  it("labels the final attempt", () => {
    const prompt = buildImplBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 3,
      maxAttempts: 3,
      failureFeedback: "test failed",
      implPlan: IMPL_PLAN,
    });
    expect(prompt).toContain("FINAL");
    expect(prompt).toContain("no further retries");
  });

  it("forbids editing tests on retry", () => {
    const prompt = buildImplBuilderRetryPrompt({
      state: BASE_STATE,
      attempt: 2,
      maxAttempts: 3,
      failureFeedback: "x",
      implPlan: IMPL_PLAN,
    });
    expect(prompt).toMatch(/never edit the test/i);
  });
});