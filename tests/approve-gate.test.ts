import { describe, expect, it } from "vitest";
import {
  isClean,
  isHardBlocked,
  OPTIONAL_HEADINGS,
  validateArtifactContent,
} from "@/approve-gate";

const TEMPLATE = `# Requirement

## Overview

{{OVERVIEW}}

## Goals

{{GOALS}}

## Delta from Existing Architecture

{{DELTA}}
`;

describe("approve-gate", () => {
  describe("validateArtifactContent", () => {
    it("reports missing when content is null", () => {
      const result = validateArtifactContent(null, TEMPLATE, []);
      expect(result.missing).toBe(true);
      expect(result.placeholderLines).toEqual([]);
      expect(result.aiCommentLines).toEqual([]);
      expect(result.missingHeadings).toEqual([]);
      expect(isHardBlocked(result)).toBe(true);
    });

    it("passes clean content with all template headings, no placeholders, no AI comments", () => {
      const content = `# Requirement

## Overview

This feature does X.

## Goals

Ship X by Friday.

## Delta from Existing Architecture

No prior architecture.
`;
      const result = validateArtifactContent(content, TEMPLATE, []);
      expect(isHardBlocked(result)).toBe(false);
      expect(result.missingHeadings).toEqual([]);
      expect(isClean(result)).toBe(true);
    });

    it("hard-blocks on a leftover {{placeholder}} line", () => {
      const content = `## Overview

{{OVERVIEW}}

## Goals

Ship X.

## Delta from Existing Architecture

None.
`;
      const result = validateArtifactContent(content, TEMPLATE, []);
      expect(isHardBlocked(result)).toBe(true);
      expect(result.placeholderLines).toContain("{{OVERVIEW}}");
    });

    it("hard-blocks on a leftover <!-- AI: ... --> comment", () => {
      const content = `## Overview

<!-- AI: describe the feature here -->
Real content.

## Goals

Ship X.

## Delta from Existing Architecture

None.
`;
      const result = validateArtifactContent(content, TEMPLATE, []);
      expect(isHardBlocked(result)).toBe(true);
      expect(result.aiCommentLines).toContain(
        "<!-- AI: describe the feature here -->",
      );
    });

    it("warns (does not block) on a missing non-optional template heading", () => {
      const content = `## Overview

Some content.

## Delta from Existing Architecture

None.
`;
      const result = validateArtifactContent(content, TEMPLATE, []);
      expect(isHardBlocked(result)).toBe(false);
      expect(result.missingHeadings).toContain("Goals");
      expect(isClean(result)).toBe(false);
    });

    it("excludes an optional heading from missingHeadings when allowlisted", () => {
      const content = `## Overview

Some content.

## Goals

Ship X.
`;
      const result = validateArtifactContent(
        content,
        TEMPLATE,
        OPTIONAL_HEADINGS["technical-architecture"] ?? [],
      );
      expect(result.missingHeadings).not.toContain(
        "Delta from Existing Architecture",
      );
      expect(result.missingHeadings).toEqual([]);
      expect(isHardBlocked(result)).toBe(false);
      expect(isClean(result)).toBe(true);
    });

    it("returns missingHeadings: [] when templateContent is null, without crashing", () => {
      const content = `## Overview

Some content, missing other headings entirely.
`;
      const result = validateArtifactContent(content, null, []);
      expect(result.missingHeadings).toEqual([]);
      expect(isHardBlocked(result)).toBe(false);
      expect(isClean(result)).toBe(true);
    });

    it("reports multiple issues at once: placeholder AND missing heading, still hard-blocked", () => {
      const content = `## Overview

{{OVERVIEW}}

## Delta from Existing Architecture

None.
`;
      const result = validateArtifactContent(content, TEMPLATE, []);
      expect(result.placeholderLines).toContain("{{OVERVIEW}}");
      expect(result.missingHeadings).toContain("Goals");
      expect(isHardBlocked(result)).toBe(true);
      expect(isClean(result)).toBe(false);
    });
  });
});
