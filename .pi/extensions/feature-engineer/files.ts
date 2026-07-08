/**
 * File-reading (and one file-lifecycle) helpers for the Feature Engineer
 * extension.
 *
 * Most functions here wrap Node's fs to read project files in the shape
 * the prompt builders expect. They never throw — a missing or empty file
 * is reported as `null`. One exception, `rotateConcernsFileIfExists`, is a
 * lifecycle helper: it renames a file rather than reading one, so that
 * each review cycle starts from a clean slate.
 */

import { existsSync, readdirSync, readFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  type ArtifactFileName,
  artifactFileDiskName,
  artifactPath,
  type ConfigFileName,
  CONFIG_FILES,
  configFilePath,
  configTemplatePath,
  artifactTemplatePath,
  featureDirPath,
  reviewConcernsPath,
} from "./paths.js";

/** Returns the content of a file, or null if it is missing or whitespace-only. */
export function readIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    const content = readFileSync(path, "utf8");
    if (content.trim().length === 0) return null;
    return content;
  } catch {
    return null;
  }
}

export interface ContextFiles {
  readme: string | null;
  claude: string | null;
  agents: string | null;
  prd: string | null;
}

/** Reads the four project-wide context files (README, CLAUDE, AGENTS, PRD). */
export function readContextFiles(cwd: string): ContextFiles {
  return {
    readme: readIfExists(join(cwd, "README.md")),
    claude: readIfExists(join(cwd, "CLAUDE.md")),
    agents: readIfExists(join(cwd, "AGENTS.md")),
    prd: readIfExists(join(cwd, "PRD.md")),
  };
}

/**
 * Reads a single template (config or artifact) from the user's *global*
 * templates directory at `~/.pi/agent/feature-engineer/templates/`.
 *
 * Templates are seeded into the user's home dir on first run by the
 * extension; see {@link ./seeding.ts}.
 *
 * @param homeDir override for tests; defaults to `os.homedir()`
 */
export function readTemplate(
  kind: "config" | "artifact",
  name: ConfigFileName | ArtifactFileName,
  homeDir: string = homedir(),
): string | null {
  const path =
    kind === "config"
      ? configTemplatePath(name as ConfigFileName, homeDir)
      : artifactTemplatePath(name as ArtifactFileName, homeDir);
  return readIfExists(path);
}

/**
 * Reads all six config templates from the user's *global* templates dir.
 * Templates are user-customised once and shared across projects.
 *
 * @param homeDir override for tests; defaults to `os.homedir()`
 */
export function readAllTemplates(
  homeDir: string = homedir(),
): Record<ConfigFileName, string | null> {
  const out = {} as Record<ConfigFileName, string | null>;
  for (const name of CONFIG_FILES) {
    out[name] = readTemplate("config", name, homeDir);
  }
  return out;
}

/** Reads a config file (e.g. actors.md, structure.md) inside `.feature-engineer/`. */
export function readConfigFile(cwd: string, name: ConfigFileName): string | null {
  return readIfExists(configFilePath(cwd, name));
}

/** Reads an artifact file inside a feature directory. */
export function readArtifact(
  cwd: string,
  id: number,
  slug: string,
  name: ArtifactFileName,
): string | null {
  return readIfExists(artifactPath(cwd, id, slug, name));
}

/** Returns the first non-blank line of a feature's requirement.md, or null. */
export function readRequirementFirstLine(
  cwd: string,
  id: number,
  slug: string,
): string | null {
  const content = readArtifact(cwd, id, slug, "requirement");
  if (content === null) return null;
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

export interface ExistingFeatureSummary {
  id: number;
  slug: string;
  requirementFirstLine: string | null;
  requirementPath: string;
}

/**
 * Lists every feature directory under `.feature-engineer/` and returns a
 * summary suitable for the Read Features skill. Features without a
 * requirement.md are still listed — their summary line is null.
 */
export function listExistingFeatures(cwd: string): ExistingFeatureSummary[] {
  const feBase = join(cwd, ".feature-engineer");
  if (!existsSync(feBase)) return [];
  let entries: string[];
  try {
    entries = readdirSync(feBase);
  } catch {
    return [];
  }
  const out: ExistingFeatureSummary[] = [];
  for (const entry of entries) {
    const match = /^feature-(\d+)-(.+)$/.exec(entry);
    if (!match || !match[1] || !match[2]) continue;
    const id = Number.parseInt(match[1], 10);
    if (!Number.isFinite(id)) continue;
    const slug = match[2];
    out.push({
      id,
      slug,
      requirementFirstLine: readRequirementFirstLine(cwd, id, slug),
      requirementPath: join(
        featureDirPath(cwd, id, slug),
        artifactFileDiskName("requirement") ?? "requirement.md",
      ),
    });
  }
  out.sort((a, b) => a.id - b.id);
  return out;
}

/**
 * Rotates an existing `06-review-concerns-to-address.md` out of the way
 * before a new review cycle starts, so that pass 1 always creates a fresh
 * file and downstream parsing (gate summary, severity recommendation,
 * routing) only ever sees the current cycle's concerns.
 *
 * The previous cycle's file is preserved — not deleted — as
 * `06-review-concerns.v<N>.md`, where N is the lowest positive integer not
 * already used in the feature directory. This keeps every past review
 * cycle available as an audit trail while guaranteeing the active,
 * unversioned filename always reflects only the in-progress cycle.
 *
 * No-op (no rename, no error) if the active concerns file does not exist —
 * this is the normal case for a feature's first review cycle.
 */
export function rotateConcernsFileIfExists(cwd: string, id: number, slug: string): void {
  const activePath = reviewConcernsPath(cwd, id, slug);
  if (!existsSync(activePath)) return;

  const dir = featureDirPath(cwd, id, slug);
  let n = 1;
  while (existsSync(join(dir, `06-review-concerns.v${n}.md`))) {
    n += 1;
  }
  const versionedPath = join(dir, `06-review-concerns.v${n}.md`);
  renameSync(activePath, versionedPath);
}
