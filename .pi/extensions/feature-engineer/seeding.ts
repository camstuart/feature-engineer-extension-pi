/**
 * Template seeding for the Feature Engineer extension.
 *
 * On first run (and idempotently on every run), the extension copies its
 * bundled template defaults from inside the installed package into the user's
 * global template directory at `~/.pi/agent/feature-engineer/templates/`.
 * The user customises templates there once; every project they touch picks
 * up the customised versions.
 *
 * Templates are **not** copied per-project — they are global. Per-project
 * state still lives in `.feature-engineer/` (config files, feature
 * directories, features-index.md), but the source-of-truth templates live
 * in the user's home dir.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_TEMPLATES_DIR,
  CONFIG_TEMPLATES_DIR,
  globalTemplatesDir,
} from "./paths.js";

export interface PackageLayout {
  /** Absolute path to the package root (resolved from the running module). */
  packageRoot: string;
  /**
   * Absolute path to the bundled templates directory, or `null` if the
   * running module's package layout does not include templates (i.e. the
   * extension was loaded from a location that does not ship them).
   */
  templatesDir: string | null;
}

export interface SeedResult {
  /** Absolute path to the directory templates were copied into. */
  targetDir: string;
  /** Source directory used for the copy (`null` if no templates to seed). */
  sourceDir: string | null;
  /** Relative paths (under targetDir) of files newly written. */
  copied: string[];
  /** Relative paths (under targetDir) of files that were preserved (already existed). */
  skipped: string[];
}

/**
 * Resolves the package layout from the URL of the running module.
 *
 * The extension entry point lives at
 * `<packageRoot>/.pi/extensions/feature-engineer/index.ts`, so the package
 * root is three levels up from the module directory.
 */
export function resolvePackageLayout(moduleUrl: string): PackageLayout {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  // Layout assumption: packageRoot/.pi/extensions/feature-engineer/index.ts
  const packageRoot = resolve(moduleDir, "..", "..", "..");
  const candidate = join(packageRoot, ".feature-engineer", "templates");
  const templatesDir = existsSync(candidate) ? candidate : null;
  return { packageRoot, templatesDir };
}

/**
 * Copies bundled templates into the user's global templates directory.
 *
 * Existing files at the target are preserved — the user may have customised
 * them, and we never overwrite user edits. Newly copied files are recorded
 * in the returned {@link SeedResult} so the caller can show a "Seeded N
 * templates" notification on first run.
 *
 * No-op (and no directory creation) when the package ships no templates.
 */
export function seedTemplates(layout: PackageLayout, homeDir: string): SeedResult {
  const targetDir = globalTemplatesDir(homeDir);

  if (layout.templatesDir === null || !existsSync(layout.templatesDir)) {
    return { targetDir, sourceDir: null, copied: [], skipped: [] };
  }

  mkdirSync(targetDir, { recursive: true });

  const copied: string[] = [];
  const skipped: string[] = [];

  for (const subdir of [CONFIG_TEMPLATES_DIR, ARTIFACT_TEMPLATES_DIR]) {
    const sourceSubdir = join(layout.templatesDir, subdir);
    const targetSubdir = join(targetDir, subdir);
    if (!existsSync(sourceSubdir)) continue;

    mkdirSync(targetSubdir, { recursive: true });

    for (const entry of readdirSync(sourceSubdir)) {
      const sourceFile = join(sourceSubdir, entry);
      const targetFile = join(targetSubdir, entry);
      // Skip non-files (sub-directories, symlinks to dirs, etc.).
      let isFile = false;
      try {
        isFile = statSync(sourceFile).isFile();
      } catch {
        continue;
      }
      if (!isFile) continue;

      const relPath = `templates/${subdir}/${entry}`;
      if (existsSync(targetFile)) {
        skipped.push(relPath);
      } else {
        copyFileSync(sourceFile, targetFile);
        copied.push(relPath);
      }
    }
  }

  return { targetDir, sourceDir: layout.templatesDir, copied, skipped };
}