/**
 * Tests for the version resolver.
 *
 * The module reads `<packageRoot>/package.json` and returns the `version`
 * field. We verify both the happy path (real package.json) and the
 * fallback paths (missing file, malformed JSON, missing field).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readVersionFromPackageJson, resolvePackageRoot } from "@/version";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "fe-version-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("version", () => {
  describe("resolvePackageRoot", () => {
    it("returns the absolute root for a module URL inside .pi/extensions/", () => {
      // Build a fake layout mirroring the published package:
      //   <root>/.pi/extensions/feature-engineer/version.ts
      const root = join(workdir, "pkg");
      const modulePath = join(
        root,
        ".pi",
        "extensions",
        "feature-engineer",
        "version.ts",
      );
      // fileURLToPath needs a file:// URL.
      const moduleUrl = `file://${modulePath}`;
      expect(resolvePackageRoot(moduleUrl)).toBe(root);
    });
  });

  describe("readVersionFromPackageJson", () => {
    it("returns the version string when package.json is well-formed", () => {
      const root = join(workdir, "pkg");
      mkdirSync(root, { recursive: true });
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ name: "feature-engineer", version: "1.2.3" }),
        "utf8",
      );
      expect(readVersionFromPackageJson(root)).toBe("1.2.3");
    });

    it("returns the fallback when package.json does not exist", () => {
      expect(readVersionFromPackageJson(workdir)).toBe("0.0.0");
    });

    it("returns the fallback when package.json contains invalid JSON", () => {
      writeFileSync(join(workdir, "package.json"), "{ not json", "utf8");
      expect(readVersionFromPackageJson(workdir)).toBe("0.0.0");
    });

    it("returns the fallback when version field is missing", () => {
      writeFileSync(
        join(workdir, "package.json"),
        JSON.stringify({ name: "feature-engineer" }),
        "utf8",
      );
      expect(readVersionFromPackageJson(workdir)).toBe("0.0.0");
    });

    it("returns the fallback when version field is not a string", () => {
      writeFileSync(
        join(workdir, "package.json"),
        JSON.stringify({ version: 42 }),
        "utf8",
      );
      expect(readVersionFromPackageJson(workdir)).toBe("0.0.0");
    });

    it("returns the fallback when version field is an empty string", () => {
      writeFileSync(
        join(workdir, "package.json"),
        JSON.stringify({ version: "" }),
        "utf8",
      );
      expect(readVersionFromPackageJson(workdir)).toBe("0.0.0");
    });

    it("matches the real package.json in this repo", () => {
      // Sanity check: the actual package.json at the repo root must
      // produce a non-fallback version. This catches accidental
      // breakage of the layout assumption in resolvePackageRoot.
      // We resolve the package root from the version module's URL,
      // not the test's URL, because the layout assumption places
      // version.ts at `<root>/.pi/extensions/feature-engineer/`.
      const versionModulePath = join(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        ".pi",
        "extensions",
        "feature-engineer",
        "version.ts",
      );
      const versionModuleUrl = pathToFileURL(versionModulePath).href;
      const realRoot = resolvePackageRoot(versionModuleUrl);
      const version = readVersionFromPackageJson(realRoot);
      expect(version).not.toBe("0.0.0");
      // semver shape: major.minor.patch
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
