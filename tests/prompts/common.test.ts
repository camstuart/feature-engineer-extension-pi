import { describe, expect, it } from "vitest";
import {
  automatedSkillReminder,
  codeBlock,
  exampleBlock,
  interactiveApprovalReminder,
  revisionFeedbackBlock,
  reviewConcernsBlock,
  skillHeader,
  templatePopulationReminder,
} from "@/prompts/common";
import type { FeatureState } from "@/state";

const STATE: FeatureState = {
  featureId: 7,
  featureSlug: "user-login",
  featureDir: "/abs/.feature-engineer/feature-007-user-login",
  step: "req-gathering",
};

describe("prompts/common", () => {
  describe("skillHeader", () => {
    it("renders a markdown header with feature id and slug", () => {
      expect(skillHeader(STATE, "Requirement Gathering")).toBe(
        "# Requirement Gathering — Feature 007: user-login",
      );
    });

    it("zero-pads feature ids below 1000", () => {
      const s = { ...STATE, featureId: 1 };
      expect(skillHeader(s, "X")).toContain("Feature 001: user-login");
    });
  });

  describe("codeBlock", () => {
    it("returns a labelled fenced markdown block", () => {
      const lines = codeBlock("Foo", "bar\nbaz");
      const text = lines.join("\n");
      expect(text).toContain("## Foo");
      expect(text).toContain("```markdown");
      expect(text).toContain("bar");
      expect(text).toContain("baz");
    });

    it("trims content and handles empty content safely", () => {
      const lines = codeBlock("Empty", "");
      expect(lines.join("\n")).not.toContain("undefined");
    });
  });

  describe("exampleBlock", () => {
    it("includes the label, the example content, and a note", () => {
      const lines = exampleBlock("Overview", "A self-service reset flow.", "1-2 sentences.");
      expect(lines.join("\n")).toContain("## Example — Overview");
      expect(lines.join("\n")).toContain("A self-service reset flow.");
      expect(lines.join("\n")).toContain("*1-2 sentences.*");
    });
  });

  describe("templatePopulationReminder", () => {
    it("instructs to replace placeholders and remove AI comments", () => {
      const lines = templatePopulationReminder();
      const text = lines.join("\n");
      expect(text).toMatch(/\{\{placeholder\}\}/);
      expect(text).toMatch(/<!-- AI/);
      expect(text).toMatch(/Replace every/);
      expect(text).toMatch(/Remove every/);
    });
  });

  describe("interactiveApprovalReminder", () => {
    it("describes the self-check the LLM must run", () => {
      const lines = interactiveApprovalReminder("X approved");
      const text = lines.join("\n");
      expect(text).toContain("Self-check");
      expect(text).toMatch(/\{\{placeholder\}\}/);
      expect(text).toMatch(/<!-- AI/);
    });

    it("describes the /feature approve and /feature reject flow", () => {
      const lines = interactiveApprovalReminder("X approved");
      const text = lines.join("\n");
      expect(text).toContain("/feature approve");
      expect(text).toContain("/feature reject");
    });

    it("does NOT instruct the LLM to call ui.confirm (orchestrator handles the gate)", () => {
      const lines = interactiveApprovalReminder("X approved");
      const text = lines.join("\n");
      expect(text).not.toMatch(/ui\.confirm/);
    });

    it("tells the LLM to end the turn after writing", () => {
      const lines = interactiveApprovalReminder("X approved");
      const text = lines.join("\n");
      expect(text).toMatch(/End your turn/i);
    });
  });

  describe("automatedSkillReminder", () => {
    it("explains the skill auto-advances", () => {
      const text = automatedSkillReminder().join("\n");
      expect(text).toContain("automated skill");
      expect(text).toMatch(/advance/i);
    });
  });

  describe("revisionFeedbackBlock", () => {
    it("returns an empty array when feedback is null", () => {
      expect(revisionFeedbackBlock(null)).toEqual([]);
    });

    it("returns an empty array when feedback is empty or whitespace", () => {
      expect(revisionFeedbackBlock("")).toEqual([]);
      expect(revisionFeedbackBlock("   ")).toEqual([]);
    });

    it("returns a labelled block when feedback is present", () => {
      const lines = revisionFeedbackBlock("Add offline mode coverage");
      const text = lines.join("\n");
      expect(text).toContain("## Revision Feedback");
      expect(text).toContain("Add offline mode coverage");
    });
  });

  describe("reviewConcernsBlock", () => {
    it("returns an empty array when concerns is null or undefined", () => {
      expect(reviewConcernsBlock(null)).toEqual([]);
      expect(reviewConcernsBlock(undefined)).toEqual([]);
    });

    it("returns an empty array when concerns is empty or whitespace", () => {
      expect(reviewConcernsBlock("")).toEqual([]);
      expect(reviewConcernsBlock("   ")).toEqual([]);
    });

    it("returns a labelled block when concerns are present", () => {
      const lines = reviewConcernsBlock("The retry loop never terminates.");
      const text = lines.join("\n");
      expect(text).toContain("## Review Concerns To Address");
      expect(text).toContain("The retry loop never terminates.");
    });
  });
});