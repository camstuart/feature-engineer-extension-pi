import { describe, expect, it } from "vitest";
import {
  type FeatureIndexEntry,
  type FeatureStatus,
  formatIndexRow,
  formatIndexTable,
  parseIndexLine,
  updateIndex,
} from "@/features-index";

describe("features-index", () => {
  describe("parseIndexLine", () => {
    it("parses a well-formed data row", () => {
      expect(
        parseIndexLine("| 001 | user-authentication | User login with OTP | COMPLETE | 2026-06-19 |"),
      ).toEqual({
        id: 1,
        slug: "user-authentication",
        description: "User login with OTP",
        status: "COMPLETE",
        date: "2026-06-19",
      });
    });

    it("returns null for the header row", () => {
      expect(parseIndexLine("| ID | Slug | Description | Status | Date |")).toBeNull();
    });

    it("returns null for the separator row", () => {
      expect(parseIndexLine("|---|---|---|---|---|")).toBeNull();
    });

    it("returns null for empty lines", () => {
      expect(parseIndexLine("")).toBeNull();
      expect(parseIndexLine("   ")).toBeNull();
    });

    it("returns null for malformed rows", () => {
      expect(parseIndexLine("| 001 | foo | bar |")).toBeNull();
      expect(parseIndexLine("| abc | foo | bar | baz | qux |")).toBeNull();
    });
  });

  describe("formatIndexRow", () => {
    it("renders a row with padded ID and status", () => {
      const entry: FeatureIndexEntry = {
        id: 7,
        slug: "x",
        description: "Hello",
        status: "IN_PROGRESS",
        date: "2026-06-20",
      };
      expect(formatIndexRow(entry)).toBe("| 007 | x | Hello | IN_PROGRESS | 2026-06-20 |");
    });
  });

  describe("formatIndexTable", () => {
    it("renders header + rows with a leading title", () => {
      const text = formatIndexTable([
        {
          id: 1,
          slug: "a",
          description: "first",
          status: "COMPLETE",
          date: "2026-01-01",
        },
        {
          id: 2,
          slug: "b",
          description: "second",
          status: "IN_PROGRESS",
          date: "2026-01-02",
        },
      ]);
      expect(text).toContain("# Features Index");
      expect(text).toContain("| ID | Slug | Description | Status | Date |");
      expect(text).toContain("|---|---|---|---|---|");
      expect(text).toContain("| 001 | a | first | COMPLETE | 2026-01-01 |");
      expect(text).toContain("| 002 | b | second | IN_PROGRESS | 2026-01-02 |");
    });

    it("renders a sensible empty state", () => {
      const text = formatIndexTable([]);
      expect(text).toContain("# Features Index");
      expect(text).toContain("_No features yet_");
    });
  });

  describe("updateIndex", () => {
    const existing = formatIndexTable([
      { id: 1, slug: "a", description: "first", status: "COMPLETE", date: "2026-01-01" },
      { id: 2, slug: "b", description: "second", status: "IN_PROGRESS", date: "2026-01-02" },
    ]);

    it("appends a new entry", () => {
      const updated = updateIndex(existing, {
        id: 3,
        slug: "c",
        description: "third",
        status: "COMPLETE",
        date: "2026-01-03",
      });
      expect(updated).toContain("| 003 | c | third | COMPLETE | 2026-01-03 |");
      expect(updated).toContain("| 001 | a | first | COMPLETE | 2026-01-01 |");
    });

    it("updates an existing entry when ID matches", () => {
      const updated = updateIndex(existing, {
        id: 2,
        slug: "b",
        description: "second updated",
        status: "COMPLETE",
        date: "2026-01-05",
      });
      expect(updated).toContain("| 002 | b | second updated | COMPLETE | 2026-01-05 |");
      expect(updated).not.toContain("IN_PROGRESS");
    });

    it("preserves unknown statuses", () => {
      const updated = updateIndex(existing, {
        id: 4,
        slug: "d",
        description: "fourth",
        status: "BLOCKED" as FeatureStatus,
        date: "2026-01-06",
      });
      expect(updated).toContain("| 004 | d | fourth | BLOCKED | 2026-01-06 |");
    });

    it("creates the file when nothing exists", () => {
      const updated = updateIndex("", {
        id: 1,
        slug: "first",
        description: "first feature",
        status: "COMPLETE",
        date: "2026-01-01",
      });
      expect(updated).toContain("# Features Index");
      expect(updated).toContain("| 001 | first | first feature | COMPLETE | 2026-01-01 |");
    });
  });
});
