import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readArtifact,
  readConfigFile,
  readContextFiles,
  readRequirementFirstLine,
  readTemplate,
  readAllTemplates,
} from "@/files";
import {
  artifactTemplatePath,
  configFilePath,
  configTemplatePath,
} from "@/paths";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "fe-files-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("files", () => {
  describe("readContextFiles", () => {
    it("returns all four context files (with nulls for missing)", () => {
      const ctx = readContextFiles(home);
      expect(ctx).toEqual({
        readme: null,
        claude: null,
        agents: null,
        prd: null,
      });
    });

    it("returns content for each file that exists", () => {
      writeFileSync(join(home, "README.md"), "# Readme", "utf8");
      writeFileSync(join(home, "CLAUDE.md"), "# Claude", "utf8");
      writeFileSync(join(home, "AGENTS.md"), "# Agents", "utf8");
      writeFileSync(join(home, "PRD.md"), "# PRD", "utf8");
      const ctx = readContextFiles(home);
      expect(ctx.readme).toContain("Readme");
      expect(ctx.claude).toContain("Claude");
      expect(ctx.agents).toContain("Agents");
      expect(ctx.prd).toContain("PRD");
    });

    it("returns null for empty files", () => {
      writeFileSync(join(home, "README.md"), "", "utf8");
      const ctx = readContextFiles(home);
      expect(ctx.readme).toBeNull();
    });
  });

  describe("readTemplate", () => {
    it("returns the content of a config template", () => {
      mkdirSync(join(home, ".pi", "agent", "feature-engineer", "templates", "config"), {
        recursive: true,
      });
      writeFileSync(configTemplatePath("actors", home), "# actors template", "utf8");
      const content = readTemplate("config", "actors", home);
      expect(content).toContain("actors template");
    });

    it("returns the content of an artifact template", () => {
      mkdirSync(join(home, ".pi", "agent", "feature-engineer", "templates", "artifacts"), {
        recursive: true,
      });
      writeFileSync(artifactTemplatePath("requirement", home), "# req template", "utf8");
      const content = readTemplate("artifact", "requirement", home);
      expect(content).toContain("req template");
    });

    it("returns null when the template file is missing", () => {
      const content = readTemplate("config", "actors", home);
      expect(content).toBeNull();
    });
  });

  describe("readAllTemplates", () => {
    it("returns all six config templates as nulls when none exist", () => {
      const result = readAllTemplates(home);
      for (const name of [
        "actors",
        "structure",
        "tech-stack",
        "qa-static-tools",
        "qa-engineering",
        "git-strategy",
      ] as const) {
        expect(result[name]).toBeNull();
      }
    });

    it("populates templates that exist", () => {
      mkdirSync(join(home, ".pi", "agent", "feature-engineer", "templates", "config"), {
        recursive: true,
      });
      writeFileSync(configTemplatePath("actors", home), "A", "utf8");
      writeFileSync(configTemplatePath("structure", home), "S", "utf8");
      const result = readAllTemplates(home);
      expect(result.actors).toBe("A");
      expect(result.structure).toBe("S");
      expect(result["tech-stack"]).toBeNull();
    });
  });

  describe("readConfigFile (per-project)", () => {
    it("returns content when file exists", () => {
      const project = mkdtempSync(join(tmpdir(), "fe-proj-"));
      try {
        mkdirSync(join(project, ".feature-engineer"), { recursive: true });
        writeFileSync(configFilePath(project, "actors"), "populated", "utf8");
        expect(readConfigFile(project, "actors")).toBe("populated");
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });

    it("returns null when file missing", () => {
      const project = mkdtempSync(join(tmpdir(), "fe-proj-"));
      try {
        expect(readConfigFile(project, "actors")).toBeNull();
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });

    it("returns null for empty file", () => {
      const project = mkdtempSync(join(tmpdir(), "fe-proj-"));
      try {
        mkdirSync(join(project, ".feature-engineer"), { recursive: true });
        writeFileSync(configFilePath(project, "actors"), "  \n", "utf8");
        expect(readConfigFile(project, "actors")).toBeNull();
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });
  });

  describe("readArtifact (per-feature, per-project)", () => {
    it("returns content when artifact exists", () => {
      const project = mkdtempSync(join(tmpdir(), "fe-proj-"));
      try {
        const dir = join(project, ".feature-engineer", "feature-001-foo");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "01-requirement.md"), "# Req", "utf8");
        expect(readArtifact(project, 1, "foo", "requirement")).toBe("# Req");
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });

    it("returns null when artifact missing", () => {
      const project = mkdtempSync(join(tmpdir(), "fe-proj-"));
      try {
        expect(readArtifact(project, 1, "foo", "requirement")).toBeNull();
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });
  });

  describe("readRequirementFirstLine (per-feature, per-project)", () => {
    it("returns the first non-empty line", () => {
      const project = mkdtempSync(join(tmpdir(), "fe-proj-"));
      try {
        const dir = join(project, ".feature-engineer", "feature-001-foo");
        mkdirSync(dir, { recursive: true });
        writeFileSync(
          join(dir, "01-requirement.md"),
          "\n\n# Feature: User login\n\nMore content",
          "utf8",
        );
        expect(readRequirementFirstLine(project, 1, "foo")).toBe("# Feature: User login");
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });

    it("returns null when missing", () => {
      const project = mkdtempSync(join(tmpdir(), "fe-proj-"));
      try {
        expect(readRequirementFirstLine(project, 1, "foo")).toBeNull();
      } finally {
        rmSync(project, { recursive: true, force: true });
      }
    });
  });
});