/**
 * Project-initialisation checks for the Feature Engineer extension.
 *
 * These functions inspect the working directory to determine whether the
 * project has been initialised (config files populated). They do NOT seed
 * templates — that is the extension's job on every command invocation
 * (see `./seeding.ts`). Templates live globally at
 * `~/.pi/agent/feature-engineer/templates/` and are seeded once for the
 * user, then shared across every project they touch.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import {
  CONFIG_FILES,
  type ConfigFileName,
  configFilePath,
  featureEngineerDir,
} from "./paths.js";

export interface InitialisationStatus {
  /** True when .feature-engineer/ exists AND every config file is populated. */
  ready: boolean;
  /** Whether the .feature-engineer/ directory exists. */
  dirExists: boolean;
  /** Config files that are missing or empty. Empty when ready. */
  missingConfigFiles: ConfigFileName[];
}

/**
 * Inspects the cwd and reports initialisation status. Never throws — a
 * missing or invalid path is reported as `ready: false`.
 */
export function checkInitialisation(cwd: string): InitialisationStatus {
  const feDir = featureEngineerDir(cwd);
  const dirExists = existsSync(feDir);

  const missing: ConfigFileName[] = [];
  if (dirExists) {
    for (const name of CONFIG_FILES) {
      const path = configFilePath(cwd, name);
      if (!existsSync(path)) {
        missing.push(name);
        continue;
      }
      try {
        const content = readFileSync(path, "utf8");
        if (content.trim().length === 0) missing.push(name);
      } catch {
        missing.push(name);
      }
    }
  } else {
    missing.push(...CONFIG_FILES);
  }

  return {
    ready: dirExists && missing.length === 0,
    dirExists,
    missingConfigFiles: missing,
  };
}

/**
 * Ensures the `.feature-engineer/` directory exists, creating it if needed.
 * Returns the directory path. Idempotent.
 */
export function ensureFeatureEngineerDir(cwd: string): string {
  const feDir = featureEngineerDir(cwd);
  mkdirSync(feDir, { recursive: true });
  return feDir;
}

/**
 * Returns true when a feature directory exists at the given path.
 * Pure file-system check — does not create anything.
 */
export function featureDirExists(absPath: string): boolean {
  try {
    return existsSync(absPath);
  } catch {
    return false;
  }
}
