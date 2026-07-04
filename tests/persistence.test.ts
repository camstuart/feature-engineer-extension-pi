import { describe, expect, it } from "vitest";
import {
  type PersistedFeatureState,
  encodeState,
  isPersistedState,
  latestState,
  nextStepFor,
} from "@/persistence";
import type { FeatureState } from "@/state";

describe("persistence", () => {
  describe("encodeState / decodeState", () => {
    it("round-trips a state object", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "tech-design",
      };
      const encoded = encodeState(state);
      expect(encoded).toEqual(state);
    });
    it("preserves optional rejectionFeedback", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "tech-design",
        rejectionFeedback: "Add more detail",
      };
      expect(encodeState(state).rejectionFeedback).toBe("Add more detail");
    });

    it("omits rejectionFeedback when not set", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "tech-design",
      };
      expect("rejectionFeedback" in encodeState(state)).toBe(false);
    });

    it("preserves optional requirementMode ('direct')", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "req-gathering",
        requirementMode: "direct",
      };
      expect(encodeState(state).requirementMode).toBe("direct");
    });

    it("preserves optional requirementMode ('vague')", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "req-gathering",
        requirementMode: "vague",
      };
      expect(encodeState(state).requirementMode).toBe("vague");
    });

    it("omits requirementMode when not set", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "req-gathering",
      };
      expect("requirementMode" in encodeState(state)).toBe(false);
    });

    it("preserves requirementVersion (initial draft = 1)", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "req-gathering",
        requirementVersion: 1,
      };
      expect(encodeState(state).requirementVersion).toBe(1);
    });

    it("preserves requirementVersion on a later revision (e.g. 3)", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "tech-design",
        requirementVersion: 3,
      };
      expect(encodeState(state).requirementVersion).toBe(3);
    });

    it("omits requirementVersion when not set", () => {
      const state: FeatureState = {
        featureId: 5,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "tech-design",
      };
      expect("requirementVersion" in encodeState(state)).toBe(false);
    });

    it("round-trips implFailed: true (recovery pause marker)", () => {
      const state = {
        featureId: 7,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "impl-builder" as const,
        implFailed: true,
      };
      expect(encodeState(state).implFailed).toBe(true);
    });

    it("omits implFailed when undefined", () => {
      const state = {
        featureId: 7,
        featureSlug: "x",
        featureDir: "/abs/path",
        step: "impl-builder" as const,
      };
      expect("implFailed" in encodeState(state)).toBe(false);
    });
  });

  describe("nextStepFor", () => {
    it("advances linearly when no feedback given", () => {
      expect(nextStepFor("req-gathering", undefined, null)).toBe("tech-design");
      expect(nextStepFor("tech-design", undefined, null)).toBe("test-planning");
      expect(nextStepFor("github", undefined, null)).toBe("done");
    });

    it("loops back on rejection at every design skill step", () => {
      expect(nextStepFor("req-gathering", "needs more detail", null)).toBe("req-gathering");
      expect(nextStepFor("tech-design", "wrong component", null)).toBe("tech-design");
      expect(nextStepFor("test-planning", "missing edge case", null)).toBe("test-planning");
      expect(nextStepFor("impl-planning", "wrong order", null)).toBe("impl-planning");
    });

    it("treats empty feedback as no feedback (linear advance)", () => {
      expect(nextStepFor("req-gathering", "   ", null)).toBe("tech-design");
    });

    it("routes ARCHITECTURAL concern severity back to tech-design", () => {
      expect(nextStepFor("concern-severity", "fix", "ARCHITECTURAL")).toBe("tech-design");
    });

    it("routes MINOR concern severity to impl-builder", () => {
      expect(nextStepFor("concern-severity", "fix", "MINOR")).toBe("impl-builder");
    });

    it("returns null when concern-severity has no severity", () => {
      expect(nextStepFor("concern-severity", undefined, null)).toBeNull();
    });

    it("returns null after done", () => {
      expect(nextStepFor("done", undefined, null)).toBeNull();
    });

    it("returns null for unknown steps", () => {
      expect(nextStepFor("not-a-step" as FeatureState["step"], undefined, null)).toBeNull();
    });

    it("does not loop back on non-rejection-source steps", () => {
      expect(nextStepFor("init-check", "skip", null)).toBe("analyse-codebase");
      expect(nextStepFor("analyse-codebase", "redo", null)).toBe("new-or-existing");
    });
  });

  describe("isPersistedState", () => {
    it("accepts well-formed persisted state", () => {
      const valid: PersistedFeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "req-gathering",
      };
      expect(isPersistedState(valid)).toBe(true);
    });

    it("accepts persisted state with optional feedback", () => {
      const valid: PersistedFeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "req-gathering",
        rejectionFeedback: "fix it",
      };
      expect(isPersistedState(valid)).toBe(true);
    });

    it("rejects unknown step names", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "garbage",
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("rejects non-numeric featureId", () => {
      const bad = {
        featureId: "1",
        featureSlug: "x",
        featureDir: "/abs",
        step: "req-gathering",
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("rejects missing required keys", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        step: "req-gathering",
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("rejects non-string feedback with bad type", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "req-gathering",
        rejectionFeedback: 123,
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("accepts persisted state with valid requirementMode", () => {
      for (const mode of ["direct", "vague"] as const) {
        const valid: PersistedFeatureState = {
          featureId: 1,
          featureSlug: "x",
          featureDir: "/abs",
          step: "req-gathering",
          requirementMode: mode,
        };
        expect(isPersistedState(valid)).toBe(true);
      }
    });

    it("rejects persisted state with invalid requirementMode", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "req-gathering",
        requirementMode: "brainstorm",
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("accepts persisted state with valid requirementVersion", () => {
      for (const v of [1, 2, 5, 99] as const) {
        const valid: PersistedFeatureState = {
          featureId: 1,
          featureSlug: "x",
          featureDir: "/abs",
          step: "tech-design",
          requirementVersion: v,
        };
        expect(isPersistedState(valid)).toBe(true);
      }
    });

    it("rejects persisted state with zero requirementVersion", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "tech-design",
        requirementVersion: 0,
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("rejects persisted state with negative requirementVersion", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "tech-design",
        requirementVersion: -1,
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("rejects persisted state with non-integer requirementVersion", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "tech-design",
        requirementVersion: 1.5,
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("rejects persisted state with non-numeric requirementVersion", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "tech-design",
        requirementVersion: "2",
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("accepts persisted state with implFailed: true (post-QA-exhaustion recovery)", () => {
      const valid: PersistedFeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "impl-builder",
        implFailed: true,
      };
      expect(isPersistedState(valid)).toBe(true);
    });

    it("accepts persisted state with implFailed: false (cleared after recovery)", () => {
      const valid: PersistedFeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "impl-builder",
        implFailed: false,
      };
      expect(isPersistedState(valid)).toBe(true);
    });

    it("rejects persisted state with non-boolean implFailed", () => {
      const bad = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "impl-builder",
        implFailed: "yes",
      };
      expect(isPersistedState(bad)).toBe(false);
    });

    it("rejects null and primitives", () => {
      expect(isPersistedState(null)).toBe(false);
      expect(isPersistedState(undefined)).toBe(false);
      expect(isPersistedState(42)).toBe(false);
      expect(isPersistedState("hello")).toBe(false);
    });
  });

  describe("latestState", () => {
    function entry(customType: string, data: unknown) {
      return { type: "custom", customType, data };
    }

    it("returns null when no fe-state entries exist", () => {
      expect(
        latestState([
          entry("other", { foo: 1 }),
          entry("not-this", {}),
        ]),
      ).toBeNull();
    });

    it("returns the most recent valid fe-state", () => {
      const a: PersistedFeatureState = {
        featureId: 1,
        featureSlug: "a",
        featureDir: "/a",
        step: "req-gathering",
      };
      const b: PersistedFeatureState = {
        featureId: 2,
        featureSlug: "b",
        featureDir: "/b",
        step: "tech-design",
      };
      const result = latestState([entry("fe-state", a), entry("fe-state", b)]);
      expect(result).toEqual(b);
    });

    it("skips invalid fe-state entries and returns the latest valid one", () => {
      const good: PersistedFeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "req-gathering",
      };
      const result = latestState([
        entry("fe-state", { invalid: true }),
        entry("fe-state", good),
        entry("fe-state", "not an object"),
      ]);
      expect(result).toEqual(good);
    });

    it("returns null if all fe-state entries are invalid", () => {
      expect(latestState([entry("fe-state", { bad: true })])).toBeNull();
    });

    it("ignores entries that are not objects", () => {
      const valid: PersistedFeatureState = {
        featureId: 1,
        featureSlug: "x",
        featureDir: "/abs",
        step: "req-gathering",
      };
      const result = latestState([
        entry("fe-state", valid),
      ]);
      expect(result).not.toBeNull();
    });
  });
});
