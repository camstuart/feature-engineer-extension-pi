import { describe, expect, it } from "vitest";
import {
  ALL_STEPS,
  FEATURE_STEPS,
  INITIAL_STEP,
  INITIALIZATION_STEPS,
  REQUIREMENT_MODES,
  type FeatureState,
  type RequirementMode,
  getNextStep,
  isAutomatedSkill,
  isInitializationStep,
  isInteractiveSkill,
  isRequirementMode,
  isReviewTriggerStep,
  isUiStep,
  nextRequirementVersion,
  stepDisplayName,
} from "@/state";

describe("state", () => {
  describe("step ordering", () => {
    it("exposes the canonical ordered list of feature steps", () => {
      expect(FEATURE_STEPS).toEqual([
        "init-check",
        "analyse-codebase",
        "new-or-existing",
        "req-gathering",
        "tech-design",
        "test-planning",
        "impl-planning",
        "test-builder",
        "impl-builder",
        "review-completion",
        "review-concerns-gate",
        "concern-severity",
        "github",
        "done",
      ]);
    });

    it("includes terminal in ALL_STEPS", () => {
      expect(ALL_STEPS).toEqual(FEATURE_STEPS);
    });

    it("starts the workflow at init-check", () => {
      expect(INITIAL_STEP).toBe("init-check");
    });
  });

  describe("getNextStep", () => {
    it("advances through the happy path one step at a time", () => {
      const chain: Array<FeatureState["step"]> = [];
      let s: FeatureState["step"] = "init-check";
      chain.push(s);
      for (let i = 0; i < 20; i += 1) {
        const next = getNextStep(s);
        if (!next) break;
        chain.push(next);
        s = next;
      }
      expect(chain).toEqual(FEATURE_STEPS);
    });

    it("returns null after done (terminal)", () => {
      expect(getNextStep("done")).toBeNull();
    });

    it("routes analyse-codebase → new-or-existing", () => {
      expect(getNextStep("analyse-codebase")).toBe("new-or-existing");
    });

    it("routes req-gathering → tech-design", () => {
      expect(getNextStep("req-gathering")).toBe("tech-design");
    });

    it("routes github → done", () => {
      expect(getNextStep("github")).toBe("done");
    });
  });

  describe("stepDisplayName", () => {
    it("renders every step with a human-readable name", () => {
      for (const step of FEATURE_STEPS) {
        const name = stepDisplayName(step);
        expect(typeof name).toBe("string");
        expect(name.length).toBeGreaterThan(0);
        expect(name).not.toBe(step);
      }
    });

    it("has known display names", () => {
      expect(stepDisplayName("init-check")).toMatch(/init/i);
      expect(stepDisplayName("analyse-codebase")).toMatch(/analyse/i);
      expect(stepDisplayName("req-gathering")).toMatch(/requirement/i);
      expect(stepDisplayName("tech-design")).toMatch(/technical design/i);
      expect(stepDisplayName("test-builder")).toMatch(/test builder/i);
      expect(stepDisplayName("impl-builder")).toMatch(/implementation builder/i);
      expect(stepDisplayName("review-completion")).toMatch(/review/i);
      expect(stepDisplayName("review-concerns-gate")).toMatch(/concern/i);
      expect(stepDisplayName("concern-severity")).toMatch(/severity/i);
      expect(stepDisplayName("github")).toMatch(/git/i);
      expect(stepDisplayName("done")).toMatch(/complete/i);
    });
  });

  describe("classification helpers", () => {
    it("marks the right steps as initialisation steps", () => {
      expect(isInitializationStep("init-check")).toBe(true);
      expect(isInitializationStep("analyse-codebase")).toBe(true);
      expect(isInitializationStep("new-or-existing")).toBe(true);
      expect(isInitializationStep("req-gathering")).toBe(false);
      expect(isInitializationStep("done")).toBe(false);
      expect(INITIALIZATION_STEPS).toEqual([
        "init-check",
        "analyse-codebase",
        "new-or-existing",
      ]);
    });

    it("identifies UI steps (handled by orchestrator without a new session)", () => {
      expect(isUiStep("init-check")).toBe(true);
      expect(isUiStep("new-or-existing")).toBe(true);
      expect(isUiStep("review-concerns-gate")).toBe(true);
      expect(isUiStep("concern-severity")).toBe(true);
      expect(isUiStep("req-gathering")).toBe(false);
      expect(isUiStep("github")).toBe(false);
    });

    it("classifies interactive skills correctly", () => {
      expect(isInteractiveSkill("req-gathering")).toBe(true);
      expect(isInteractiveSkill("tech-design")).toBe(true);
      expect(isInteractiveSkill("test-planning")).toBe(true);
      expect(isInteractiveSkill("impl-planning")).toBe(true);
      expect(isInteractiveSkill("test-builder")).toBe(false);
      expect(isInteractiveSkill("impl-builder")).toBe(false);
      expect(isInteractiveSkill("review-completion")).toBe(false);
      expect(isInteractiveSkill("github")).toBe(false);
      expect(isInteractiveSkill("analyse-codebase")).toBe(true);
    });

    it("classifies automated skills correctly", () => {
      expect(isAutomatedSkill("test-builder")).toBe(true);
      expect(isAutomatedSkill("impl-builder")).toBe(true);
      expect(isAutomatedSkill("review-completion")).toBe(true);
      expect(isAutomatedSkill("github")).toBe(true);
      expect(isAutomatedSkill("req-gathering")).toBe(false);
      expect(isAutomatedSkill("done")).toBe(false);
    });

    it("identifies the review trigger step", () => {
      expect(isReviewTriggerStep("review-completion")).toBe(true);
      expect(isReviewTriggerStep("review-concerns-gate")).toBe(true);
      expect(isReviewTriggerStep("concern-severity")).toBe(true);
      expect(isReviewTriggerStep("req-gathering")).toBe(false);
      expect(isReviewTriggerStep("done")).toBe(false);
    });
  });

  describe("RequirementMode", () => {
    it("exposes both modes in REQUIREMENT_MODES", () => {
      expect(REQUIREMENT_MODES).toEqual(["direct", "vague"]);
    });

    it("accepts RequirementMode values in FeatureState", () => {
      const direct: FeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/x",
        step: "req-gathering",
        requirementMode: "direct",
      };
      const vague: FeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/x",
        step: "req-gathering",
        requirementMode: "vague",
      };
      const typed: RequirementMode = "direct";
      expect(direct.requirementMode).toBe("direct");
      expect(vague.requirementMode).toBe("vague");
      expect(typed).toBe("direct");
    });

    it("isRequirementMode accepts valid values and rejects others", () => {
      expect(isRequirementMode("direct")).toBe(true);
      expect(isRequirementMode("vague")).toBe(true);
      expect(isRequirementMode("brainstorm")).toBe(false);
      expect(isRequirementMode("")).toBe(false);
      expect(isRequirementMode(null)).toBe(false);
      expect(isRequirementMode(undefined)).toBe(false);
      expect(isRequirementMode(42)).toBe(false);
    });
  });

  describe("nextRequirementVersion (PRD §7.3 {{VERSION}} placeholder)", () => {
    it("bumps the version on rejection at req-gathering", () => {
      expect(
        nextRequirementVersion({
          step: "req-gathering",
          requirementVersion: 1,
        }),
      ).toBe(2);
      expect(
        nextRequirementVersion({
          step: "req-gathering",
          requirementVersion: 5,
        }),
      ).toBe(6);
    });

    it("treats undefined version as 1 (legacy / freshly-created feature)", () => {
      expect(
        nextRequirementVersion({ step: "req-gathering" }),
      ).toBe(2);
      expect(
        nextRequirementVersion({
          step: "req-gathering",
          requirementVersion: undefined,
        }),
      ).toBe(2);
    });

    it("leaves the version unchanged on rejection at later design steps", () => {
      // The requirement is unchanged when re-drafting tech-design /
      // test-planning / impl-planning, so the version stays.
      for (const step of ["tech-design", "test-planning", "impl-planning"] as const) {
        expect(
          nextRequirementVersion({ step, requirementVersion: 3 }),
        ).toBe(3);
        expect(
          nextRequirementVersion({ step, requirementVersion: undefined }),
        ).toBeUndefined();
      }
    });

    it("leaves the version unchanged for non-design steps", () => {
      // impl-builder rejection (recovery branch), automated skills, etc.
      for (const step of ["impl-builder", "test-builder", "github", "done"] as const) {
        expect(
          nextRequirementVersion({ step, requirementVersion: 2 }),
        ).toBe(2);
      }
    });
  });
});
