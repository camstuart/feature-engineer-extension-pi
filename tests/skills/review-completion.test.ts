import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildReviewIntermediateSteps } from "@/skills/review-completion";
import { REVIEW_PASSES } from "@/prompts/review-completion";
import { reviewConcernsPath } from "@/paths";
import type { FeatureState } from "@/state";

let cwd: string;

const STATE: FeatureState = {
  featureId: 1,
  featureSlug: "foo",
  featureDir: "/unused",
  step: "review-completion",
};

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "fe-review-completion-"));
  mkdirSync(join(cwd, ".feature-engineer", "feature-001-foo"), { recursive: true });
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("skills/review-completion", () => {
  describe("buildReviewIntermediateSteps", () => {
    it("builds one step per rest-pass, each with a lazy prompt function", () => {
      const [, ...restPasses] = REVIEW_PASSES;
      const steps = buildReviewIntermediateSteps({
        cwd,
        state: STATE,
        restPasses,
        fileContents: {},
        reviewFilePath: reviewConcernsPath(cwd, STATE.featureId, STATE.featureSlug),
        template: "# Review Concerns Template",
      });

      expect(steps).toHaveLength(restPasses.length);
      for (const step of steps) {
        expect(typeof step.prompt).toBe("function");
        expect(step.compactInstructions).toBeTruthy();
      }
    });

    it("re-reads the concerns file at call time, not at construction time", () => {
      const [, ...restPasses] = REVIEW_PASSES;
      const path = reviewConcernsPath(cwd, STATE.featureId, STATE.featureSlug);

      // No concerns file exists yet when the steps are constructed.
      const steps = buildReviewIntermediateSteps({
        cwd,
        state: STATE,
        restPasses,
        fileContents: {},
        reviewFilePath: path,
        template: "# Review Concerns Template",
      });

      const firstStep = steps[0]!;
      expect(typeof firstStep.prompt).toBe("function");
      const promptBeforeWrite = (firstStep.prompt as () => string)();
      expect(promptBeforeWrite).not.toContain("Pass 1 found a real problem");

      // Simulate pass 1 completing and appending to the concerns file
      // *after* the steps array was built (this is the scenario the
      // eager-read bug got wrong).
      writeFileSync(path, "## Requirements Coverage\n\nPass 1 found a real problem.\n", "utf8");

      const promptAfterWrite = (firstStep.prompt as () => string)();
      expect(promptAfterWrite).toContain("Pass 1 found a real problem");
      expect(promptAfterWrite).not.toBe(promptBeforeWrite);
    });

    it("each subsequent step also sees concerns written between passes", () => {
      const [, ...restPasses] = REVIEW_PASSES;
      const path = reviewConcernsPath(cwd, STATE.featureId, STATE.featureSlug);
      const steps = buildReviewIntermediateSteps({
        cwd,
        state: STATE,
        restPasses,
        fileContents: {},
        reviewFilePath: path,
        template: "# Review Concerns Template",
      });

      expect(steps.length).toBeGreaterThanOrEqual(2);

      // Pass 1 writes something before pass 2's prompt is resolved.
      writeFileSync(path, "## Section A\n\nFinding from pass 1.\n", "utf8");
      const pass2Prompt = (steps[0]!.prompt as () => string)();
      expect(pass2Prompt).toContain("Finding from pass 1.");

      // Pass 2 appends before pass 3's prompt is resolved.
      writeFileSync(
        path,
        "## Section A\n\nFinding from pass 1.\n\n## Section B\n\nFinding from pass 2.\n",
        "utf8",
      );
      const pass3Prompt = (steps[1]!.prompt as () => string)();
      expect(pass3Prompt).toContain("Finding from pass 1.");
      expect(pass3Prompt).toContain("Finding from pass 2.");
    });
  });
});
