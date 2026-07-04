import { describe, expect, it } from "vitest";
import {
  artifactFileDiskName,
  artifactTemplatePath,
  configFileDiskName,
  configFilePath,
  configTemplatePath,
  featureDirPath,
  featureIndexPath,
  getNextFeatureId,
  globalFeatureEngineerDir,
  globalTemplatesDir,
  padId,
  parseFeatureIdFromDirName,
  toSlug,
} from "@/paths";

describe("paths", () => {
  describe("toSlug", () => {
    it("lowercases and hyphenates a title", () => {
      expect(toSlug("User Authentication")).toBe("user-authentication");
    });

    it("collapses non-alphanumeric runs to a single hyphen", () => {
      expect(toSlug("  Hello   World!! ")).toBe("hello-world");
    });

    it("trims leading and trailing hyphens", () => {
      expect(toSlug("---foo---")).toBe("foo");
      expect(toSlug("...")).toBe("");
    });

    it("strips emoji and non-ASCII letters safely", () => {
      expect(toSlug("Café résumé 🚀")).toBe("caf-r-sum");
    });

    it("preserves digits", () => {
      expect(toSlug("OAuth 2.0 Login")).toBe("oauth-2-0-login");
    });

    it("returns empty string for empty input", () => {
      expect(toSlug("")).toBe("");
      expect(toSlug("   ")).toBe("");
    });

    it("truncates slugs longer than 64 characters", () => {
      const long = "a".repeat(100);
      const slug = toSlug(long);
      expect(slug.length).toBeLessThanOrEqual(64);
    });
  });

  describe("padId", () => {
    it("zero-pads to three digits by default", () => {
      expect(padId(1)).toBe("001");
      expect(padId(7)).toBe("007");
      expect(padId(42)).toBe("042");
      expect(padId(999)).toBe("999");
    });

    it("uses more digits for IDs >= 1000", () => {
      expect(padId(1000)).toBe("1000");
      expect(padId(1234)).toBe("1234");
    });

    it("honours an explicit width", () => {
      expect(padId(5, 5)).toBe("00005");
    });
  });

  describe("parseFeatureIdFromDirName", () => {
    it("parses well-formed directory names", () => {
      expect(parseFeatureIdFromDirName("feature-001-user-authentication")).toEqual({
        id: 1,
        slug: "user-authentication",
      });
      expect(parseFeatureIdFromDirName("feature-042-foo")).toEqual({
        id: 42,
        slug: "foo",
      });
      expect(parseFeatureIdFromDirName("feature-1000-multi-word-slug-here")).toEqual({
        id: 1000,
        slug: "multi-word-slug-here",
      });
    });

    it("returns null for malformed names", () => {
      expect(parseFeatureIdFromDirName("001-foo")).toBeNull();
      expect(parseFeatureIdFromDirName("feature-foo")).toBeNull();
      expect(parseFeatureIdFromDirName("feature-1")).toBeNull();
      expect(parseFeatureIdFromDirName("random-dir")).toBeNull();
      expect(parseFeatureIdFromDirName("")).toBeNull();
    });
  });

  describe("getNextFeatureId", () => {
    it("returns 1 for an empty directory", () => {
      expect(getNextFeatureId([])).toBe(1);
    });

    it("returns max+1 for a list of feature directories", () => {
      expect(getNextFeatureId(["feature-001-a", "feature-002-b"])).toBe(3);
      expect(getNextFeatureId(["feature-007-c", "feature-002-d"])).toBe(8);
    });

    it("ignores non-feature directories", () => {
      expect(getNextFeatureId(["templates", "feature-005-x", ".DS_Store"])).toBe(6);
    });

    it("ignores malformed feature directories", () => {
      expect(getNextFeatureId(["feature-foo", "feature-003-real"])).toBe(4);
    });

    it("treats gaps correctly", () => {
      expect(getNextFeatureId(["feature-001-a", "feature-005-b"])).toBe(6);
    });
  });

  describe("directory & file path builders", () => {
    const cwd = "/abs/project";

    it("builds the per-feature directory path", () => {
      expect(featureDirPath(cwd, 1, "user-authentication")).toBe(
        "/abs/project/.feature-engineer/feature-001-user-authentication",
      );
    });

    it("builds the features-index path", () => {
      expect(featureIndexPath(cwd)).toBe("/abs/project/.feature-engineer/features-index.md");
    });

    it("builds config file output paths with numeric prefix", () => {
      expect(configFilePath(cwd, "actors")).toBe(
        "/abs/project/.feature-engineer/01-actors.md",
      );
      expect(configFilePath(cwd, "structure")).toBe(
        "/abs/project/.feature-engineer/02-structure.md",
      );
      expect(configFilePath(cwd, "tech-stack")).toBe(
        "/abs/project/.feature-engineer/03-tech-stack.md",
      );
      expect(configFilePath(cwd, "qa-static-tools")).toBe(
        "/abs/project/.feature-engineer/04-qa-static-tools.md",
      );
      expect(configFilePath(cwd, "qa-engineering")).toBe(
        "/abs/project/.feature-engineer/05-qa-engineering.md",
      );
      expect(configFilePath(cwd, "git-strategy")).toBe(
        "/abs/project/.feature-engineer/06-git-strategy.md",
      );
    });

    it("configFileDiskName returns the prefixed filename", () => {
      expect(configFileDiskName("actors")).toBe("01-actors.md");
      expect(configFileDiskName("git-strategy")).toBe("06-git-strategy.md");
    });

    it("artifactFileDiskName returns the prefixed filename", () => {
      expect(artifactFileDiskName("requirement")).toBe("01-requirement.md");
      expect(artifactFileDiskName("relevant-components")).toBe("02-relevant-components.md");
      expect(artifactFileDiskName("technical-architecture")).toBe("03-technical-architecture.md");
      expect(artifactFileDiskName("technical-plan-testing")).toBe("04-technical-plan-testing.md");
      expect(artifactFileDiskName("technical-plan-implementation")).toBe("05-technical-plan-implementation.md");
      expect(artifactFileDiskName("review-concerns-to-address")).toBe("06-review-concerns-to-address.md");
    });

    it("artifactFileDiskName returns null for template names", () => {
      expect(artifactFileDiskName("review-concerns")).toBeNull();
    });
  });

  describe("global template paths", () => {
    it("globalFeatureEngineerDir uses .pi/agent/feature-engineer by default", () => {
      const home = "/Users/example";
      expect(globalFeatureEngineerDir(home)).toBe("/Users/example/.pi/agent/feature-engineer");
    });

    it("globalTemplatesDir is a subdirectory of the global dir", () => {
      const home = "/Users/example";
      expect(globalTemplatesDir(home)).toBe("/Users/example/.pi/agent/feature-engineer/templates");
    });

    it("configTemplatePath resolves under the global templates dir", () => {
      const home = "/Users/example";
      expect(configTemplatePath("actors", home)).toBe(
        "/Users/example/.pi/agent/feature-engineer/templates/config/actors.md",
      );
      expect(configTemplatePath("structure", home)).toBe(
        "/Users/example/.pi/agent/feature-engineer/templates/config/structure.md",
      );
      expect(configTemplatePath("qa-static-tools", home)).toBe(
        "/Users/example/.pi/agent/feature-engineer/templates/config/qa-static-tools.md",
      );
    });

    it("artifactTemplatePath resolves under the global templates dir", () => {
      const home = "/Users/example";
      expect(artifactTemplatePath("requirement", home)).toBe(
        "/Users/example/.pi/agent/feature-engineer/templates/artifacts/requirement.md",
      );
      expect(artifactTemplatePath("technical-architecture", home)).toBe(
        "/Users/example/.pi/agent/feature-engineer/templates/artifacts/technical-architecture.md",
      );
    });
  });
});
