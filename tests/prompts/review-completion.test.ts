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
    it("contains exactly 8 review passes covering the required areas", () => {
      expect(REVIEW_PASSES).toHaveLength(8);
      const ids = REVIEW_PASSES.map((p) => p.id);
      expect(ids).toEqual([
        "actors-coverage",
        "file-structure",
        "tech-stack",
        "static-qa",
        "engineering-principles",
        "git-strategy",
        "requirements-coverage",
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
  });

  describe("buildReviewPassPrompt", () => {
    it("renders an actors-coverage pass with actors + requirement files", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES.find((p) => p.id === "actors-coverage")!,
        fileContents: {
          "01-actors.md": "# Actors\n\nUser, Admin",
          "01-requirement.md": "# Requirement\n\nstuff",
        },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/06-review-concerns-to-address.md",
        template: "# Review Concerns\n<!-- AI: ... -->",
      });

      expect(prompt).toContain("actors-coverage");
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
        pass: REVIEW_PASSES.find((p) => p.id === "actors-coverage")!,
        fileContents: {},
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain("actors.md");
      expect(prompt).toMatch(/missing/i);
    });

    it("includes prior concerns block when priorConcerns is non-null (passes 2-8)", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: "## Actors Coverage\n- [MAJOR] missing actor X",
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

    it("specifies a concrete concern format (severity + observation + fix)", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      expect(prompt).toContain("Concern Format");
      expect(prompt).toMatch(/\[<severity>\]/);
    });

    it("explains what the orchestrator does after all 8 passes", () => {
      const prompt = buildReviewPassPrompt({
        pass: REVIEW_PASSES[0]!,
        fileContents: { "actors.md": "x" },
        priorConcerns: null,
        state: BASE_STATE,
        reviewConcernsPath: "/x/r.md",
        template: "t",
      });

      // P1.2 fix: the prompt explains the real orchestrator behaviour, not
      // a fake "the final pass will summarise" claim.
      expect(prompt).toContain("What Happens Next");
      expect(prompt).toMatch(/orchestrator/i);
    });
  });

  it("typecheck: every ReviewPassId maps to a defined pass", () => {
    const ids: ReviewPassId[] = [
      "actors-coverage",
      "file-structure",
      "tech-stack",
      "static-qa",
      "engineering-principles",
      "git-strategy",
      "requirements-coverage",
      "architecture-conformance",
    ];
    for (const id of ids) {
      expect(REVIEW_PASSES.find((p) => p.id === id)).toBeDefined();
    }
  });
});