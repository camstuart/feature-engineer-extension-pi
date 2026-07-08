/**
 * Deterministic git-strategy checks.
 *
 * `06-git-strategy.md` is a user-editable config file (see
 * `templates/config/git-strategy.md`). This module parses the small set of
 * structured, backtick-quoted lines it may contain (mirroring the
 * `Label: \`value\`` convention used by `qa.ts`'s `parseQAStaticTools`) and
 * uses them to run deterministic (non-LLM) checks against the repository's
 * actual git state: does the current branch match the configured naming
 * pattern, do any commits exist relative to the base branch, and (when a
 * commit-format pattern is configured) do commit subjects match it.
 *
 * Design note — reusability for branch creation (Task 9):
 * `parseGitStrategyConfig` and `resolveBranchName` are pure, generic
 * "compute the expected branch name" helpers with no notion of "checking"
 * baked into their names or behaviour. `index.ts`'s `handleApprove` reuses
 * them, together with `ensureBranchCheckedOut`, to create/checkout the
 * feature branch up front (on approving `impl-planning`) using the exact
 * same parsing + substitution logic. The github skill (`skills/github.ts`)
 * separately reuses `countCommitsSinceBase` to verify commits exist before
 * pushing. Only `runGitStrategyChecks` and `writeGitStrategyFindings` are
 * specific to the review-completion diagnostic/concern-reporting use case.
 *
 * Judgment call — "base branch" default:
 * The spec requires checking "at least one commit exists on the feature
 * branch" but every branch trivially has commits somewhere in its history
 * (it's part of the whole repo's history). A meaningful check needs a base
 * branch to diff against (`git rev-list --count <base>..HEAD`). Neither the
 * spec nor design.md dictates this explicitly, so this module supports an
 * optional structured `Base branch:` line and, when absent, defaults to
 * `"main"`. This mirrors this repo's own `.feature-engineer/git-strategy.md`
 * ("Default branch: `main`. ... Branch from `main`."), which is the common
 * convention across the projects this extension targets. Projects using a
 * different trunk name (e.g. `master`, `develop`) should add an explicit
 * `Base branch:` line.
 *
 * Graceful degradation philosophy (same as `qa.ts`'s `runQACommands`):
 * this module never throws. Any git subprocess failure, missing capability
 * (e.g. base branch doesn't exist, not inside a git repo, malformed regex
 * config), or unparseable config line results in silently skipping the
 * affected check(s) rather than crashing the review flow or reporting a
 * false/misleading concern.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Structured git-strategy configuration parsed from `06-git-strategy.md`. */
export interface GitStrategyConfig {
  /** Branch naming pattern, e.g. `"feature/{slug}"`. Always set (defaulted). */
  branchPattern: string;
  /**
   * Commit-subject format regex source, e.g.
   * `"^(feat|fix): .+"`. Null when not configured — commit-format
   * validation is skipped in that case.
   */
  commitPattern: string | null;
  /** Branch to diff against for commit-existence/format checks. Defaults to `"main"`. */
  baseBranch: string;
}

/** Substitution values available to {@link resolveBranchName}. */
export interface BranchNameSubs {
  slug: string;
  id: number;
}

const DEFAULT_BRANCH_PATTERN = "feature/{slug}";
const DEFAULT_BASE_BRANCH = "main";

/**
 * Parses `06-git-strategy.md` content for structured, backtick-quoted
 * config lines:
 *
 *   Branch pattern: `feature/{slug}`
 *   Commit pattern: `^(feat|fix): .+`
 *   Base branch: `main`
 *
 * Each line is optional. Missing or malformed (e.g. missing backticks)
 * lines fall back to defaults: `branchPattern` → `"feature/{slug}"`,
 * `commitPattern` → `null`, `baseBranch` → `"main"`.
 */
export function parseGitStrategyConfig(content: string): GitStrategyConfig {
  return {
    branchPattern: extractLabelledValue(content, "Branch pattern") ?? DEFAULT_BRANCH_PATTERN,
    commitPattern: extractLabelledValue(content, "Commit pattern"),
    baseBranch: extractLabelledValue(content, "Base branch") ?? DEFAULT_BASE_BRANCH,
  };
}

/** Extracts a `Label: \`value\`` line's value, or null if absent/malformed. */
function extractLabelledValue(content: string, label: string): string | null {
  const re = new RegExp(`^${escapeRegExp(label)}\\s*:\\s*\`([^\`]+)\``, "im");
  const m = re.exec(content);
  if (!m) return null;
  const value = (m[1] ?? "").trim();
  return value.length > 0 ? value : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Pure substitution of `{slug}` and `{id}` tokens into a branch (or
 * commit) pattern. No zero-padding is applied to `{id}` — callers who want
 * zero-padded IDs (e.g. `feat/007-slug`) should pre-format the `id` value
 * themselves (e.g. via `padId` from `./paths.js`) before calling this
 * function. Keeping this function's substitution simple/raw makes it
 * predictable for both the review-check use case (Task 4) and the
 * branch-creation use case (Task 9).
 */
export function resolveBranchName(pattern: string, subs: BranchNameSubs): string {
  return pattern.replaceAll("{slug}", subs.slug).replaceAll("{id}", String(subs.id));
}

/**
 * Runs the deterministic git-strategy diagnostics and returns a list of
 * concern bullet strings (each already formatted as
 * `- [MINOR] <observation> → <fix>`), suitable for direct insertion into
 * the review concerns file. An empty array means all checks that could
 * run passed cleanly (or every check was skipped due to a degraded
 * capability — see module doc comment).
 *
 * Never throws: every git subprocess call is wrapped so any failure
 * (not a git repo, branch/ref doesn't exist, git not installed, etc.)
 * degrades to skipping the affected check rather than crashing the
 * review-completion flow.
 */
export function runGitStrategyChecks(
  cwd: string,
  config: GitStrategyConfig,
  subs: BranchNameSubs,
): string[] {
  const concerns: string[] = [];

  const currentBranch = getCurrentBranch(cwd);
  if (currentBranch !== null) {
    const expected = resolveBranchName(config.branchPattern, subs);
    if (currentBranch !== expected) {
      concerns.push(
        `- [MINOR] Current branch "${currentBranch}" does not match the configured pattern (expected "${expected}") → checkout or rename to the expected branch name.`,
      );
    }
  }

  if (!branchExistsLocally(cwd, config.baseBranch)) {
    // Degraded capability, not a strategy violation — skip silently.
    return concerns;
  }

  const commitCount = countCommitsSinceBase(cwd, config.baseBranch);
  if (commitCount === null) {
    // Couldn't determine commit count for some other reason; skip silently.
    return concerns;
  }
  if (commitCount === 0) {
    concerns.push(
      `- [MINOR] No commits found on the current branch relative to ${config.baseBranch} → commit the implementation work before completing the review.`,
    );
    return concerns;
  }

  if (config.commitPattern !== null) {
    const subjects = getCommitSubjects(cwd, config.baseBranch);
    if (subjects !== null) {
      let regex: RegExp | null;
      try {
        regex = new RegExp(config.commitPattern);
      } catch {
        regex = null;
      }
      if (regex !== null) {
        const offending = subjects.filter((s) => !regex.test(s));
        if (offending.length > 0) {
          const shown = offending.slice(0, 3).map((s) => truncate(s, 80));
          const more = offending.length > 3 ? ` (+${offending.length - 3} more)` : "";
          concerns.push(
            `- [MINOR] Commit subject(s) do not match the configured commit pattern (${config.commitPattern}): ${shown.map((s) => `"${s}"`).join(", ")}${more} → reword the offending commit(s) to follow the configured convention.`,
          );
        }
      }
    }
  }

  return concerns;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function getCurrentBranch(cwd: string): string | null {
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const branch = out.toString("utf8").trim();
    return branch.length > 0 ? branch : null;
  } catch {
    return null;
  }
}

/** Result of {@link ensureBranchCheckedOut}. */
export interface EnsureBranchResult {
  ok: boolean;
  branch: string;
  /** Trimmed stderr/error message when `ok` is false. */
  error?: string;
}

/**
 * Ensures `branchName` is checked out in the working tree: no-ops if
 * already current, checks it out if it exists locally (e.g. from a prior
 * review cycle), or creates it fresh with `git checkout -b`.
 *
 * Never throws — git failures are captured and returned in the result so
 * the caller (`index.ts`'s `handleApprove`) can notify the user and keep
 * the workflow parked at `impl-planning` rather than silently proceeding
 * with the wrong branch checked out.
 */
export function ensureBranchCheckedOut(cwd: string, branchName: string): EnsureBranchResult {
  const current = getCurrentBranch(cwd);
  if (current === branchName) return { ok: true, branch: branchName };

  const exists = branchExistsLocally(cwd, branchName);
  try {
    if (exists) {
      execFileSync("git", ["checkout", branchName], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    } else {
      execFileSync("git", ["checkout", "-b", branchName], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    return { ok: true, branch: branchName };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const stderr =
      err.stderr === undefined
        ? ""
        : Buffer.isBuffer(err.stderr)
          ? err.stderr.toString("utf8")
          : err.stderr;
    return {
      ok: false,
      branch: branchName,
      error: (stderr || err.message || "unknown git error").trim(),
    };
  }
}

/**
 * Checks whether `branchName` exists as a local branch ref. Despite the
 * historical name, this is generic — used both for base-branch existence
 * checks (above, in `runGitStrategyChecks`) and for feature-branch existence
 * checks (`ensureBranchCheckedOut`, Task 9).
 */
function branchExistsLocally(cwd: string, branchName: string): boolean {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the number of commits on `HEAD` relative to `baseBranch`
 * (`git rev-list --count <baseBranch>..HEAD`), or `null` if it could not be
 * determined (e.g. `baseBranch` doesn't exist locally, not a git repo).
 *
 * Exported for reuse by the github skill's deterministic pre-check (Task 9):
 * it verifies commits exist on the feature branch before starting the LLM
 * session, without pulling in the full `runGitStrategyChecks`
 * diagnostic/concern-formatting pipeline.
 */
export function countCommitsSinceBase(cwd: string, baseBranch: string): number | null {
  try {
    const out = execFileSync("git", ["rev-list", "--count", `${baseBranch}..HEAD`], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const n = Number.parseInt(out.toString("utf8").trim(), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function getCommitSubjects(cwd: string, baseBranch: string): string[] | null {
  try {
    const out = execFileSync("git", ["log", `${baseBranch}..HEAD`, "--format=%s"], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out
      .toString("utf8")
      .split(/\r?\n/)
      .filter((s) => s.length > 0);
  } catch {
    return null;
  }
}

/**
 * Splices `findings` into the `## Git Strategy` section of a review
 * concerns file, replacing whatever content currently sits between that
 * heading and the next `## ` heading (or EOF) — including any AI comment
 * placeholder the LLM left behind. Writes `- No concerns.\n` when
 * `findings` is empty.
 *
 * No-ops (does not crash, does not create the file/heading) when:
 *   - the concerns file does not exist yet, or
 *   - the file exists but has no `## Git Strategy` heading (indicates the
 *     review-concerns template itself is misconfigured — out of scope to
 *     fix here).
 */
export function writeGitStrategyFindings(
  concernsFilePath: string,
  findings: readonly string[],
): void {
  if (!existsSync(concernsFilePath)) return;

  let content: string;
  try {
    content = readFileSync(concernsFilePath, "utf8");
  } catch {
    return;
  }

  const headingRe = /^##\s+Git Strategy\s*$/m;
  const headingMatch = headingRe.exec(content);
  if (headingMatch === null) return;

  const sectionStart = headingMatch.index + headingMatch[0].length;
  // Find the next top-level heading after this one, or EOF.
  const rest = content.slice(sectionStart);
  const nextHeadingRe = /^##\s+.+$/m;
  const nextMatch = nextHeadingRe.exec(rest);
  const sectionEnd = nextMatch ? sectionStart + nextMatch.index : content.length;

  const bodyText = findings.length === 0 ? "- No concerns." : findings.join("\n");
  // Preserve the template's convention of a blank line separating a
  // section's body from the next `## ` heading (see
  // `templates/artifacts/review-concerns.md`). No trailing blank line is
  // added when this is the last section (EOF).
  const separator = sectionEnd < content.length ? "\n\n" : "\n";

  const newContent = `${content.slice(0, sectionStart)}\n${bodyText}${separator}${content.slice(sectionEnd)}`;

  try {
    writeFileSync(concernsFilePath, newContent, "utf8");
  } catch {
    // Best-effort; nothing more we can do here.
  }
}
