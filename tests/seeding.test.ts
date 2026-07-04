import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolvePackageLayout, seedTemplates } from "@/seeding";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "fe-seed-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/**
 * Build a fake package layout that mimics the published artifact:
 *   <root>/.pi/extensions/feature-engineer/index.ts
 *   <root>/.feature-engineer/templates/config/<one-or-more>.md
 *   <root>/.feature-engineer/templates/artifacts/<one-or-more>.md
 */
function makeFakePackage(withTemplates: boolean): {
  root: string;
  moduleUrl: string;
  expectedTemplateCount: number;
} {
  const root = join(workdir, "pkg");
  mkdirSync(join(root, ".pi", "extensions", "feature-engineer"), { recursive: true });
  writeFileSync(join(root, ".pi", "extensions", "feature-engineer", "index.ts"), "// stub\n", "utf8");

  let count = 0;
  if (withTemplates) {
    const configDir = join(root, ".feature-engineer", "templates", "config");
    const artifactDir = join(root, ".feature-engineer", "templates", "artifacts");
    mkdirSync(configDir, { recursive: true });
    mkdirSync(artifactDir, { recursive: true });
    writeFileSync(join(configDir, "actors.md"), "# actors default\n", "utf8");
    writeFileSync(join(configDir, "structure.md"), "# structure default\n", "utf8");
    writeFileSync(join(artifactDir, "requirement.md"), "# req default\n", "utf8");
    writeFileSync(join(artifactDir, "review-concerns.md"), "# concerns default\n", "utf8");
    count = 4;
  }

  return {
    root,
    moduleUrl: pathToFileURL(join(root, ".pi", "extensions", "feature-engineer", "index.ts")).href,
    expectedTemplateCount: count,
  };
}

describe("seeding", () => {
  describe("resolvePackageLayout", () => {
    it("resolves the package root and templates dir from a module URL", () => {
      const { root, moduleUrl } = makeFakePackage(true);
      const layout = resolvePackageLayout(moduleUrl);
      expect(layout.packageRoot).toBe(root);
      expect(layout.templatesDir).toBe(join(root, ".feature-engineer", "templates"));
    });

    it("returns templatesDir=null when the package ships no templates", () => {
      const { moduleUrl } = makeFakePackage(false);
      const layout = resolvePackageLayout(moduleUrl);
      expect(layout.templatesDir).toBeNull();
    });
  });

  describe("seedTemplates", () => {
    it("copies all bundled templates to the global target dir", () => {
      const { root, moduleUrl, expectedTemplateCount } = makeFakePackage(true);
      const layout = resolvePackageLayout(moduleUrl);
      const home = join(workdir, "home");
      const result = seedTemplates(layout, home);

      expect(result.copied.length).toBe(expectedTemplateCount);
      expect(result.skipped.length).toBe(0);
      expect(result.targetDir).toBe(join(home, ".pi", "agent", "feature-engineer", "templates"));

      // Spot-check a couple of files:
      const actorsPath = join(
        home,
        ".pi",
        "agent",
        "feature-engineer",
        "templates",
        "config",
        "actors.md",
      );
      expect(existsSync(actorsPath)).toBe(true);
      expect(readFileSync(actorsPath, "utf8")).toBe("# actors default\n");

      const reqPath = join(
        home,
        ".pi",
        "agent",
        "feature-engineer",
        "templates",
        "artifacts",
        "requirement.md",
      );
      expect(readFileSync(reqPath, "utf8")).toBe("# req default\n");

      // Verify source files are unchanged:
      expect(
        readFileSync(join(root, ".feature-engineer", "templates", "config", "actors.md"), "utf8"),
      ).toBe("# actors default\n");
    });

    it("does not overwrite existing user-customised templates", () => {
      const { moduleUrl } = makeFakePackage(true);
      const layout = resolvePackageLayout(moduleUrl);
      const home = join(workdir, "home");
      const customPath = join(
        home,
        ".pi",
        "agent",
        "feature-engineer",
        "templates",
        "config",
        "actors.md",
      );
      mkdirSync(join(home, ".pi", "agent", "feature-engineer", "templates", "config"), {
        recursive: true,
      });
      writeFileSync(customPath, "MY CUSTOM CONTENT", "utf8");

      const result = seedTemplates(layout, home);

      expect(readFileSync(customPath, "utf8")).toBe("MY CUSTOM CONTENT");
      expect(result.skipped).toContain("templates/config/actors.md");
      // The other three files should still have been copied:
      expect(result.copied.length).toBe(3);
    });

    it("is idempotent — running twice is a no-op the second time", () => {
      const { moduleUrl, expectedTemplateCount } = makeFakePackage(true);
      const layout = resolvePackageLayout(moduleUrl);
      const home = join(workdir, "home");

      const first = seedTemplates(layout, home);
      expect(first.copied.length).toBe(expectedTemplateCount);

      const second = seedTemplates(layout, home);
      expect(second.copied.length).toBe(0);
      expect(second.skipped.length).toBe(expectedTemplateCount);
    });

    it("is a no-op when the package ships no templates", () => {
      const { moduleUrl } = makeFakePackage(false);
      const layout = resolvePackageLayout(moduleUrl);
      const home = join(workdir, "home");

      const result = seedTemplates(layout, home);

      expect(result.copied).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.sourceDir).toBeNull();
      // The target directory should NOT have been created either:
      expect(existsSync(join(home, ".pi", "agent", "feature-engineer"))).toBe(false);
    });

    it("does not touch unrelated files in the target home", () => {
      const { moduleUrl } = makeFakePackage(true);
      const layout = resolvePackageLayout(moduleUrl);
      const home = join(workdir, "home");
      mkdirSync(join(home, "some-other-dir"), { recursive: true });
      writeFileSync(join(home, "some-other-dir", "settings.json"), "{}\n", "utf8");

      seedTemplates(layout, home);

      expect(readFileSync(join(home, "some-other-dir", "settings.json"), "utf8")).toBe("{}\n");
    });
  });
});