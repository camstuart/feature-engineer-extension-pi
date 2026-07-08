import { describe, expect, it } from "vitest";
import {
  REVIEW_PASSES,
  buildReviewPassPrompt,
  type ReviewPassId,
} from "@/prompts/review-completion";

const BASE_STATE = {
  featureId: 1,
  featureSlug: "x",
  featureDir: "/x",
  step: "review-completion" as const,
};

describe("prompts/review-completion", () => {
  describe("REVIEW_PASSES", () => {
    it("contains exactly 5 review passes covering the required areas", () => {
      expect(REVIEW_PASSES).toHaveLength(5);
      const ids = REVIEW_PASSES.map((p) => p.id);
      expect(ids).toEqual([
        "requirements-coverage",
        "file-structure",
        "tech-stack",
        "engineering-principles",
        "architecture-conformance",
      ]);
    });

    it("every pass lists the files it should review", () => {
      for (const pass of REVIEW_PASSES) {
        expect(pass.files.length).toBeGreaterThan(0);
      }
    });

    it("every pass has a question and instructions", () => {
      for (const pass of REVIEW_PASSES) {
        expect(pass.question.length).toBeGreaterThan(20);
        expect(pass.instructions.length).toBeGreaterThan(20);
      }
    });

    it("requirements-coverage absorbs actor/user-story coverage from the former actors-coverage pass", () => {
      const pass = REVIEW_PASSES.find((p) => p.id === "requirements-coverage")!;
      expect(pass.files).toContain("01-actors.md");
      expect(pass.files).toContain("01-requirement.md");
      expect(pass.question).toMatch(/actor/i);
      expect(pass.question).toMatch(/user stor/i);
      expect(pass.question).toMatch(/requirement/i);
      expect(pass.instructions).toMatch(/actor/i);
      expect(pass.instructions).toMatch(/requirement/i);
    });
  });

  describe("buildReviewPassPrompt", () => {
    it("renders a requirements-coverage pass with actors + requirement files", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES.find((p) => p.id === "requirements-coverage")!,
        fileContents: {
          "01-actors.md": "# Actors\n\nUser, Admin",
          "01-requirement.md": "# Requirement\n\nstuff",
        },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/06-review-concerns-to-address.md",
        template: "# Review Concerns\n<!-- AI: ... -->",
      });

      expect(prompt).toContain("requirements-coverage");
      expect(prompt).toContain("01-actors.md");
      expect(prompt).toContain("01-requirement.md");
      expect(prompt).toContain("User, Admin");
      expect(prompt).toContain("/x/06-review-concerns-to-address.md");
    });

    it("uses the pass's question and instructions", () => {
      const pass = REVIEW_PASSES[0]!;
      const prompt = buildReviewPassPrompt({
        pass,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain(pass.question);
      expect(prompt).toContain(pass.instructions);
    });

    it("includes the template so the LLM knows the document structure", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "TEMPLATE_CONTENT",
      });

      expect(prompt).toContain("TEMPLATE_CONTENT");
    });

    it("instructs the agent to end the turn (runner compacts)", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toMatch(/end your turn/i);
    });

    it("handles missing file contents gracefully", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES.find((p) => p.id === "requirements-coverage")!,
        fileContents: {},
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain("01-requirement.md");
      expect(prompt).toMatch(/missing/i);
    });

    it("includes prior concerns block when priorConcerns is non-null (passes 2-5)", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: "## Requirements Coverage\n- [MINOR] missing actor X",
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain("Prior Review Concerns");
      expect(prompt).toContain("missing actor X");
    });

    it("does NOT include prior concerns block when priorConcerns is null (pass 1)", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).not.toContain("Prior Review Concerns");
    });

    it("specifies the ARCH/MINOR concern format (tag + observation + fix) and no legacy severity tags", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain("Concern Format");
      expect(prompt).toMatch(/\[ARCH\|MINOR\]/);
      expect(prompt).toContain("ARCH");
      expect(prompt).toContain("MINOR");
      expect(prompt).not.toMatch(/\bBLOCKER\b/);
      expect(prompt).not.toMatch(/\bMAJOR\b/);
      expect(prompt).not.toMatch(/\bNIT\b/);
    });

    it("states the single No-concerns convention without a contradictory 'leave empty' instruction", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain("- No concerns.");
      expect(prompt).not.toMatch(/leave a heading'?s body empty/i);
    });

    it("explains the real routing after all 5 passes: clean auto-advances, concerns hit a user gate", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain("What Happens Next");
      expect(prompt).toMatch(/orchestrator/i);
      expect(prompt).toMatch(/auto-advance/i);
      expect(prompt).toMatch(/GitHub/);
      expect(prompt).toMatch(/user gate|user picks|recommended route/i);
    });
  });

  it("typecheck: every ReviewPassId maps to a defined pass", () => {
    const ids: ReviewPassId[] = [
      "requirements-coverage",
      "file-structure",
      "tech-stack",
      "engineering-principles",
      "architecture-conformance",
    ];
    for (const id of ids) {
      expect(REVIEW_PASSES.find((p) => p.id === id)).toBeDefined();
    }
  });
});
