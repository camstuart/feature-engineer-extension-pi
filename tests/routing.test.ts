import { describe, expect, it } from "vitest";
import {
  formatConcernSummary,
  parseConcernCounts,
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

  describe("parseConcernCounts", () => {
    it("returns all zeros and recommends MINOR for null content", () => {
      const counts = parseConcernCounts(null);
      expect(counts).toEqual({
        archCount: 0,
        minorCount: 0,
        untaggedCount: 0,
        total: 0,
        recommendedSeverity: "MINOR",
      });
    });

    it("treats '- No concerns.' lines as zero concerns across multiple sections", () => {
      const content = [
        "## Architecture",
        "- No concerns.",
        "",
        "## Style",
        "- No concerns.",
      ].join("\n");
      const counts = parseConcernCounts(content);
      expect(counts.total).toBe(0);
      expect(counts.archCount).toBe(0);
      expect(counts.minorCount).toBe(0);
      expect(counts.untaggedCount).toBe(0);
      expect(counts.recommendedSeverity).toBe("MINOR");
    });

    it("treats '- no concerns.' (lowercase) lines as zero concerns", () => {
      const content = [
        "## Architecture",
        "- no concerns.",
        "",
        "## Style",
        "- NO CONCERNS.",
      ].join("\n");
      const counts = parseConcernCounts(content);
      expect(counts.total).toBe(0);
      expect(counts.archCount).toBe(0);
      expect(counts.minorCount).toBe(0);
      expect(counts.untaggedCount).toBe(0);
      expect(counts.recommendedSeverity).toBe("MINOR");
    });

    it("counts one ARCH and three MINOR and recommends ARCHITECTURAL", () => {
      const content = [
        "- [ARCH] Coupling is too tight → extract an interface",
        "- [MINOR] Rename variable → use camelCase",
        "- [MINOR] Missing comment → add one",
        "- [MINOR] Typo in log message → fix spelling",
      ].join("\n");
      const counts = parseConcernCounts(content);
      expect(counts.archCount).toBe(1);
      expect(counts.minorCount).toBe(3);
      expect(counts.untaggedCount).toBe(0);
      expect(counts.total).toBe(4);
      expect(counts.recommendedSeverity).toBe("ARCHITECTURAL");
    });

    it("recommends MINOR when only MINOR concerns exist", () => {
      const content = [
        "- [MINOR] Rename variable → use camelCase",
        "- [MINOR] Missing comment → add one",
      ].join("\n");
      const counts = parseConcernCounts(content);
      expect(counts.archCount).toBe(0);
      expect(counts.minorCount).toBe(2);
      expect(counts.recommendedSeverity).toBe("MINOR");
    });

    it("counts an untagged bullet as untagged, included in total, and still routes MINOR", () => {
      const content = "- The error message is unclear → reword it";
      const counts = parseConcernCounts(content);
      expect(counts.untaggedCount).toBe(1);
      expect(counts.archCount).toBe(0);
      expect(counts.minorCount).toBe(0);
      expect(counts.total).toBe(1);
      expect(counts.recommendedSeverity).toBe("MINOR");
    });

    it("recognises tags case-insensitively", () => {
      const content = ["- [arch] lowercase tag", "- [Minor] mixed case tag"].join("\n");
      const counts = parseConcernCounts(content);
      expect(counts.archCount).toBe(1);
      expect(counts.minorCount).toBe(1);
      expect(counts.recommendedSeverity).toBe("ARCHITECTURAL");
    });

    it("ignores heading lines and blank lines", () => {
      const content = [
        "## Architecture",
        "",
        "## Style",
        "",
        "- [MINOR] a real concern",
        "",
      ].join("\n");
      const counts = parseConcernCounts(content);
      expect(counts.total).toBe(1);
      expect(counts.minorCount).toBe(1);
    });

    it("also accepts '*' bullet markers", () => {
      const content = "* [ARCH] star-bulleted concern";
      const counts = parseConcernCounts(content);
      expect(counts.archCount).toBe(1);
      expect(counts.total).toBe(1);
    });
  });

  describe("formatConcernSummary", () => {
    it("reports a clean summary for zero concerns", () => {
      const summary = formatConcernSummary(parseConcernCounts(null));
      expect(summary.toLowerCase()).toContain("no concerns");
    });

    it("reports counts and recommendation for mixed concerns", () => {
      const content = [
        "- [ARCH] Coupling is too tight → extract an interface",
        "- [MINOR] Rename variable → use camelCase",
        "- The error message is unclear → reword it",
      ].join("\n");
      const summary = formatConcernSummary(parseConcernCounts(content));
      expect(summary).toContain("3 concern(s)");
      expect(summary).toContain("1 ARCH");
      expect(summary).toContain("2 MINOR");
      expect(summary).toContain("1 untagged");
      expect(summary).toContain("Recommended route: ARCHITECTURAL");
    });
  });
});
