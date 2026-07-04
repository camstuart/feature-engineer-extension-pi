import { describe, expect, it } from "vitest";
import {
  REQUIREMENT_MODE_CHOICES,
  REQUIREMENT_MODE_DIRECT_LABEL,
  REQUIREMENT_MODE_VAGUE_LABEL,
  type Severity,
  isRejectionSource,
  isValidSeverity,
  parseRejectArgs,
  parseRequirementMode,
  parseSubcommand,
  SEVERITY_NEXT_STEP,
} from "@/routing";

describe("routing", () => {
  describe("isRejectionSource", () => {
    it("identifies design skill steps as rejection sources", () => {
      expect(isRejectionSource("req-gathering")).toBe(true);
      expect(isRejectionSource("tech-design")).toBe(true);
      expect(isRejectionSource("test-planning")).toBe(true);
      expect(isRejectionSource("impl-planning")).toBe(true);
    });

    it("rejects non-design-skill steps", () => {
      expect(isRejectionSource("init-check")).toBe(false);
      expect(isRejectionSource("analyse-codebase")).toBe(false);
      expect(isRejectionSource("new-or-existing")).toBe(false);
      expect(isRejectionSource("test-builder")).toBe(false);
      expect(isRejectionSource("impl-builder")).toBe(false);
      expect(isRejectionSource("review-completion")).toBe(false);
      expect(isRejectionSource("concern-severity")).toBe(false);
      expect(isRejectionSource("github")).toBe(false);
      expect(isRejectionSource("done")).toBe(false);
    });
  });

  describe("parseRequirementMode", () => {
    it("maps the direct label to 'direct'", () => {
      expect(parseRequirementMode(REQUIREMENT_MODE_DIRECT_LABEL)).toBe("direct");
    });

    it("maps the vague label to 'vague'", () => {
      expect(parseRequirementMode(REQUIREMENT_MODE_VAGUE_LABEL)).toBe("vague");
    });

    it("returns null for unknown strings", () => {
      expect(parseRequirementMode("brainstorm")).toBeNull();
      expect(parseRequirementMode("")).toBeNull();
    });

    it("returns null for non-strings", () => {
      expect(parseRequirementMode(null)).toBeNull();
      expect(parseRequirementMode(undefined)).toBeNull();
      expect(parseRequirementMode(42)).toBeNull();
      expect(parseRequirementMode({})).toBeNull();
    });

    it("exposes two stable choice labels in REQUIREMENT_MODE_CHOICES", () => {
      expect(REQUIREMENT_MODE_CHOICES).toHaveLength(2);
      expect(REQUIREMENT_MODE_CHOICES[0]).toBe(REQUIREMENT_MODE_DIRECT_LABEL);
      expect(REQUIREMENT_MODE_CHOICES[1]).toBe(REQUIREMENT_MODE_VAGUE_LABEL);
    });
  });

  describe("SEVERITY_NEXT_STEP", () => {
    it("ARCHITECTURAL routes back to tech-design", () => {
      expect(SEVERITY_NEXT_STEP.ARCHITECTURAL).toBe("tech-design");
    });

    it("MINOR routes to impl-builder", () => {
      expect(SEVERITY_NEXT_STEP.MINOR).toBe("impl-builder");
    });
  });

  describe("parseRejectArgs", () => {
    it("returns the trimmed feedback string", () => {
      expect(parseRejectArgs("  needs more detail  ")).toEqual({
        feedback: "needs more detail",
      });
    });

    it("returns null feedback for empty input", () => {
      expect(parseRejectArgs("")).toEqual({ feedback: null });
      expect(parseRejectArgs("   ")).toEqual({ feedback: null });
    });

    it("preserves multi-word feedback verbatim", () => {
      expect(parseRejectArgs("Add OAuth support and login with email")).toEqual({
        feedback: "Add OAuth support and login with email",
      });
    });
  });

  describe("isValidSeverity", () => {
    it("accepts ARCHITECTURAL and MINOR", () => {
      expect(isValidSeverity("ARCHITECTURAL")).toBe(true);
      expect(isValidSeverity("MINOR")).toBe(true);
    });

    it("rejects other strings", () => {
      expect(isValidSeverity("major")).toBe(false);
      expect(isValidSeverity("")).toBe(false);
      expect(isValidSeverity(null)).toBe(false);
      expect(isValidSeverity(undefined)).toBe(false);
      expect(isValidSeverity(42)).toBe(false);
    });

    it("type narrows", () => {
      const s: unknown = "ARCHITECTURAL";
      if (isValidSeverity(s)) {
        const sev: Severity = s;
        expect(sev).toBe("ARCHITECTURAL");
      }
    });
  });

  describe("parseSubcommand", () => {
    it("parses bare /feature as run", () => {
      expect(parseSubcommand("")).toEqual({ kind: "run" });
      expect(parseSubcommand("   ")).toEqual({ kind: "run" });
    });

    it("parses /feature approve", () => {
      expect(parseSubcommand("approve")).toEqual({ kind: "approve" });
      expect(parseSubcommand("APPROVE")).toEqual({ kind: "approve" });
      expect(parseSubcommand("approve   ")).toEqual({ kind: "approve" });
    });

    it("parses /feature reject with feedback", () => {
      expect(parseSubcommand("reject more detail")).toEqual({
        kind: "reject",
        feedback: "more detail",
      });
      expect(parseSubcommand("REJECT")).toEqual({
        kind: "reject",
        feedback: null,
      });
      expect(parseSubcommand("reject    ")).toEqual({
        kind: "reject",
        feedback: null,
      });
    });

    it("parses /feature status", () => {
      expect(parseSubcommand("status")).toEqual({ kind: "status" });
    });

    it("falls back to run for unknown subcommand", () => {
      expect(parseSubcommand("foo")).toEqual({ kind: "run" });
      expect(parseSubcommand("something else")).toEqual({ kind: "run" });
    });
  });
});
