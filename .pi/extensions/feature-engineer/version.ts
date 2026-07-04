/**
 * Feature Engineer extension version.
 *
 * Reads the semver string from the package's `package.json` at module
 * load time. The package root is resolved relative to this module's
 * location — three levels up from
 * `<root>/.pi/extensions/feature-engineer/version.ts`.
 *
 * This works regardless of how the extension is installed:
 *   - npm (`~/.pi/agent/npm/node_modules/feature-engineer/...`)
 *   - git clone (`~/.pi/agent/git/...`)
 *   - local file/symlink (e.g. `.pi/extensions/feature-engineer/`)
 *   - direct `-e` path
 *
 * If the version cannot be read for any reason (file missing, malformed
 * JSON, no `version` field), the resolver returns `"0.0.0"` so the
 * extension still functions. The fallback is intentionally a valid
 * semver string — never `undefined` — so callers don't need to guard.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Fallback when the real version cannot be resolved. */
const UNKNOWN_VERSION = "0.0.0";

/**
 * Resolves the package root from this module's URL.
 *
 * Layout assumption: this module lives at
 * `<packageRoot>/.pi/extensions/feature-engineer/version.ts`.
 */
export function resolvePackageRoot(moduleUrl: string): string {
  const moduleDir = dirname(fileURLToPath(moduleUrl));
  return resolve(moduleDir, "..", "..", "..");
}

/**
 * Reads the version string from `<packageRoot>/package.json`.
 *
 * Returns `UNKNOWN_VERSION` if the file is missing, unreadable, contains
 * invalid JSON, or does not have a string `version` field. Never throws.
 */
export function readVersionFromPackageJson(packageRoot: string): string {
  const pkgPath = join(packageRoot, "package.json");
  try {
    const raw = readFileSync(pkgPath, "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Fall through to fallback.
  }
  return UNKNOWN_VERSION;
}

/** Eagerly-resolved version string. Used by all display surfaces. */
export const VERSION: string = readVersionFromPackageJson(
  resolvePackageRoot(import.meta.url),
);
