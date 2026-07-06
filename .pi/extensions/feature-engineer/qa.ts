/**
 * QA command parsing and result aggregation.
 *
 * The qa-static-tools.md file is user-editable. These helpers parse out the
 * commands the Implementation Builder will run after each task.
 */

import { execFileSync } from "node:child_process";

export interface QACommands {
  test: string | null;
  /** Coverage threshold as a percentage (0-100), or null if not specified. */
  testCoverageThreshold: number | null;
  typecheck: string | null;
  lint: string | null;
  lintFix: string | null;
  formatCheck: string | null;
  formatFix: string | null;
  importSort: string | null;
  build: string | null;
}

export interface QARunResult {
  command: string;
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
}

export interface QAAggregate {
  allPassed: boolean;
  passes: QARunResult[];
  failures: QARunResult[];
}

/**
 * Parses qa-static-tools.md into a structured commands object.
 *
 * Heuristic: each top-level `## Heading` starts a section. Inside a section,
 * lines of the form `Label: \`command\`` populate fields:
 *   - `Command:` → primary command
 *   - `Auto-fix command:` or `Fix command:` → *Fix variant
 *   - `Check command:` → formatCheck (in Formatter section)
 *   - `Coverage threshold:` → testCoverageThreshold (in Test Runner section)
 *
 * Section → field mapping:
 *   - Test Runner / Unit Tests / Tests → `test`
 *   - Type Checker / Type Check → `typecheck`
 *   - Linter / Lint → `lint`
 *   - Formatter / Format → `formatCheck` / `formatFix`
 *   - Import Sorter → `importSort`
 *   - Build / Compile → `build`
 */
export function parseQAStaticTools(content: string): QACommands {
  const sections = splitSections(content);
  const result: QACommands = {
    test: null,
    testCoverageThreshold: null,
    typecheck: null,
    lint: null,
    lintFix: null,
    formatCheck: null,
    formatFix: null,
    importSort: null,
    build: null,
  };

  for (const [heading, body] of sections) {
    const h = heading.toLowerCase();

    if (matchesAny(h, ["test runner", "unit tests", "tests"])) {
      result.test = extractCommand(body, "Command") ?? result.test;
      const cov = extractCoverageThreshold(body);
      if (cov !== null) result.testCoverageThreshold = cov;
    } else if (matchesAny(h, ["type checker", "type check"])) {
      result.typecheck = extractCommand(body, "Command") ?? result.typecheck;
    } else if (matchesAny(h, ["linter", "lint"])) {
      result.lint = extractCommand(body, "Command") ?? result.lint;
      result.lintFix =
        extractCommand(body, "Auto-fix command") ?? result.lintFix;
    } else if (matchesAny(h, ["formatter", "format"])) {
      result.formatCheck =
        extractCommand(body, "Check command") ??
        extractCommand(body, "Command") ??
        result.formatCheck;
      result.formatFix =
        extractCommand(body, "Fix command") ?? result.formatFix;
    } else if (matchesAny(h, ["import sorter", "imports"])) {
      result.importSort = extractCommand(body, "Command") ?? result.importSort;
    } else if (matchesAny(h, ["build", "compile"])) {
      result.build = extractCommand(body, "Command") ?? result.build;
    }
  }

  return result;
}

function splitSections(content: string): Array<[heading: string, body: string]> {
  const lines = content.split(/\r?\n/);
  const out: Array<[string, string]> = [];
  let current: [string, string] | null = null;
  for (const line of lines) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      if (current) out.push(current);
      current = [m[1] ?? "", ""];
    } else if (current) {
      current[1] += line + "\n";
    }
  }
  if (current) out.push(current);
  return out;
}

function extractCommand(body: string, label: string): string | null {
  const re = new RegExp(`^${escapeRe(label)}\\s*:\\s*\`([^\`]+)\``, "im");
  const m = re.exec(body);
  if (!m) return null;
  return (m[1] ?? "").trim();
}

function extractCoverageThreshold(body: string): number | null {
  const m = /^Coverage threshold:\s*(\d+(?:\.\d+)?)%/im.exec(body);
  if (!m) return null;
  const num = Number.parseFloat(m[1] ?? "");
  if (!Number.isFinite(num)) return null;
  return num;
}

function matchesAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Aggregate a list of command results into a pass/fail summary. */
export function aggregateQAResults(results: readonly QARunResult[]): QAAggregate {
  const passes: QARunResult[] = [];
  const failures: QARunResult[] = [];
  for (const r of results) {
    if (r.exitCode === 0) passes.push(r);
    else failures.push(r);
  }
  return { allPassed: failures.length === 0, passes, failures };
}

/** Render a short summary suitable for inline display. */
export function summariseResults(results: readonly QARunResult[]): string {
  const agg = aggregateQAResults(results);
  if (agg.allPassed) {
    return `${results.length} QA tool${results.length === 1 ? "" : "s"} passed.`;
  }
  const failedNames = agg.failures.map((f) => f.command).join(", ");
  return `${agg.failures.length} of ${results.length} QA tools failed: ${failedNames}`;
}

/**
 * Renders a single QA command's output as a markdown block, regardless of
 * its exit code. Includes the command and the last 4 KB of combined
 * stdout+stderr — enough to show the output without blowing up the prompt.
 * Truncates with a `[truncated]` marker.
 *
 * Used directly by the red-phase check to show the LLM/user the observed
 * output even when the "violation" is that a command exited 0 (e.g. tests
 * unexpectedly passing) — {@link formatFailureFeedback} would filter that
 * result out since it only renders non-zero exits.
 */
export function formatCommandOutput(result: QARunResult): string {
  const lines: string[] = [`### ${result.command}`, "", "```"];
  const combined = (result.stdout || "") + (result.stderr || "");
  const max = 4096;
  if (combined.length > max) {
    lines.push(combined.slice(combined.length - max));
    lines.push("[truncated to last 4 KB]");
  } else {
    lines.push(combined);
  }
  lines.push("```", "");
  return lines.join("\n");
}

/**
 * Render the failed commands' output as a markdown block suitable for
 * feeding back to the LLM on a retry. Filters to non-zero exit codes only —
 * suitable for the Implementation Builder's QA suite, where only genuinely
 * failed commands should be shown. Falls back to a generic "all passed"
 * message when nothing survives the filter.
 */
export function formatFailureFeedback(results: readonly QARunResult[]): string {
  const failures = results.filter((r) => r.exitCode !== 0);
  if (failures.length === 0) return "All QA tools passed.";
  const lines: string[] = [
    `QA tools failed (${failures.length}):`,
    "",
  ];
  for (const f of failures) {
    lines.push(formatCommandOutput(f));
  }
  return lines.join("\n");
}

export interface RunQAOptions {
  /** Per-command timeout in milliseconds. Default 120_000 (2 minutes). */
  timeoutMs?: number;
}

/**
 * Execute the parsed QA commands sequentially in `cwd`. Returns one
 * {@link QARunResult} per non-null command. Tools with a `null` command
 * (i.e. not configured in `04-qa-static-tools.md`) are skipped.
 *
 * The commands run with the project's working directory as their CWD.
 * We never throw on a non-zero exit — that becomes `exitCode: <n>` on the
 * result. A failure to spawn the process at all (ENOENT, etc.) becomes
 * `exitCode: undefined` and an error in `stderr`.
 *
 * Used by the Implementation Builder's orchestrator-driven retry loop:
 * after each LLM attempt, the orchestrator runs this to decide whether
 * to send a retry prompt or advance.
 */
export function runQACommands(
  cwd: string,
  commands: QACommands,
  options: RunQAOptions = {},
): QARunResult[] {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const out: QARunResult[] = [];
  const entries: Array<{ label: string; command: string | null }> = [
    { label: "test", command: commands.test },
    { label: "typecheck", command: commands.typecheck },
    { label: "lint", command: commands.lint },
    { label: "formatCheck", command: commands.formatCheck },
    { label: "importSort", command: commands.importSort },
    { label: "build", command: commands.build },
  ];
  for (const { command } of entries) {
    if (command === null) continue;
    out.push(runOne(cwd, command, timeoutMs));
  }
  return out;
}

/**
 * A violation of the Test Builder's red-phase invariant, returned by
 * {@link checkRedPhase}.
 *
 * - `typecheck-failed` — the configured type-check command exited non-zero.
 *   Test files must parse and type-check cleanly; a type error means the
 *   Test Builder wrote something broken (not a legitimate red-phase
 *   failure).
 * - `tests-passed` — the configured test command exited 0. Tests must fail
 *   until the Implementation Builder writes the matching production code;
 *   a passing suite here means the Test Builder wrote production code (or
 *   a vacuous test) by mistake.
 */
export type RedPhaseViolation =
  | { kind: "typecheck-failed"; result: QARunResult }
  | { kind: "tests-passed"; result: QARunResult };

/**
 * Verifies the Test Builder skill's red-phase invariant after it writes
 * test files: the type-checker (if configured) must exit 0, and the test
 * runner (if configured) must exit non-zero. Checks type-check first —
 * a type error is reported before test results, since the test run is
 * unreliable while the files don't even parse.
 *
 * Returns `null` when both invariants hold, or when neither command is
 * configured in `04-qa-static-tools.md` (nothing to check).
 */
export function checkRedPhase(
  cwd: string,
  commands: QACommands,
  options: RunQAOptions = {},
): RedPhaseViolation | null {
  const timeoutMs = options.timeoutMs ?? 120_000;

  if (commands.typecheck !== null) {
    const result = runOne(cwd, commands.typecheck, timeoutMs);
    if (result.exitCode !== 0) {
      return { kind: "typecheck-failed", result };
    }
  }

  if (commands.test !== null) {
    const result = runOne(cwd, commands.test, timeoutMs);
    if (result.exitCode === 0) {
      return { kind: "tests-passed", result };
    }
  }

  return null;
}

function runOne(cwd: string, command: string, timeoutMs: number): QARunResult {
  // Use a shell so users can write `npm test`, `pnpm typecheck`, `&&` chains,
  // pipes, env-vars, etc. The command is sourced from the user's own
  // qa-static-tools.md, so this is the same trust level as the LLM
  // running it directly.
  try {
    const out = execFileSync("sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });
    return { command, exitCode: 0, stdout: out.toString("utf8"), stderr: "" };
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      status?: number | null;
      stdout?: Buffer | string;
      stderr?: Buffer | string;
    };
    const stdout =
      err.stdout === undefined
        ? ""
        : Buffer.isBuffer(err.stdout)
          ? err.stdout.toString("utf8")
          : err.stdout;
    const stderr =
      err.stderr === undefined
        ? ""
        : Buffer.isBuffer(err.stderr)
          ? err.stderr.toString("utf8")
          : err.stderr;
    return {
      command,
      exitCode: typeof err.status === "number" ? err.status : undefined,
      stdout,
      stderr: stderr || err.message,
    };
  }
}
