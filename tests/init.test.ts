import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type InitialisationStatus,
  checkInitialisation,
  ensureFeatureEngineerDir,
} from "@/init";
import {
  CONFIG_FILES,
  configFilePath,
  featureEngineerDir,
} from "@/paths";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "fe-init-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("init", () => {
  describe("checkInitialisation", () => {
    it("reports missing when .feature-engineer/ does not exist", () => {
      const status = checkInitialisation(cwd);
      expect(status.ready).toBe(false);
      expect(status.dirExists).toBe(false);
      expect(status.missingConfigFiles.length).toBe(CONFIG_FILES.length);
    });

    it("reports missing when dir exists but no config files", () => {
      ensureFeatureEngineerDir(cwd);
      const status = checkInitialisation(cwd);
      expect(status.ready).toBe(false);
      expect(status.dirExists).toBe(true);
      expect(status.missingConfigFiles).toEqual([...CONFIG_FILES]);
    });

    it("reports missing when some config files are empty", () => {
      ensureFeatureEngineerDir(cwd);
      for (const name of CONFIG_FILES) {
        writeFileSync(configFilePath(cwd, name), name === "actors" ? "some content" : "", "utf8");
      }
      const status = checkInitialisation(cwd);
      expect(status.ready).toBe(false);
      expect(status.missingConfigFiles).toContain("structure");
      expect(status.missingConfigFiles).not.toContain("actors");
    });

    it("reports ready when all config files are populated", () => {
      ensureFeatureEngineerDir(cwd);
      for (const name of CONFIG_FILES) {
        writeFileSync(configFilePath(cwd, name), "populated", "utf8");
      }
      const status = checkInitialisation(cwd);
      expect(status.ready).toBe(true);
      expect(status.missingConfigFiles).toEqual([]);
    });

    it("does not throw if the cwd is invalid", () => {
      const status = checkInitialisation("/path/that/does/not/exist/anywhere");
      expect(status.ready).toBe(false);
      expect(status.dirExists).toBe(false);
    });
  });

  describe("ensureFeatureEngineerDir", () => {
    it("creates .feature-engineer/ when missing", () => {
      expect(() => ensureFeatureEngineerDir(cwd)).not.toThrow();
      const status = checkInitialisation(cwd);
      expect(status.dirExists).toBe(true);
    });

    it("is a no-op when .feature-engineer/ already exists", () => {
      ensureFeatureEngineerDir(cwd);
      expect(() => ensureFeatureEngineerDir(cwd)).not.toThrow();
    });

    it("returns the directory path", () => {
      const dir = ensureFeatureEngineerDir(cwd);
      expect(dir).toBe(featureEngineerDir(cwd));
    });
  });

  it("produces a status object shaped as InitialisationStatus", () => {
    const status: InitialisationStatus = checkInitialisation(cwd);
    expect(typeof status.ready).toBe("boolean");
    expect(typeof status.dirExists).toBe("boolean");
    expect(Array.isArray(status.missingConfigFiles)).toBe(true);
  });
});
