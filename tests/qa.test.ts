import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import {
  type QACommands,
  type QARunResult,
  aggregateQAResults,
  checkRedPhase,
  formatFailureFeedback,
  parseQAStaticTools,
  runQACommands,
  summariseResults,
} from "@/qa";

const NO_COMMANDS: QACommands = {
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

describe("qa", () => {
  describe("parseQAStaticTools", () => {
    it("extracts commands from a well-formed qa-static-tools.md file", () => {
      const md = `# QA Static Tools

## Test Runner
Command: \`bun test\`
Coverage threshold: 80%

## Type Checker
Command: \`tsc --noEmit\`

## Linter
Command: \`eslint src/\`
Auto-fix command: \`eslint src/ --fix\`

## Formatter
Check command: \`prettier --check src/\`
Fix command: \`prettier --write src/\`

## Build / Compile
Command: \`tsc -b\`
`;
      const parsed = parseQAStaticTools(md);
      expect(parsed.test).toBe("bun test");
      expect(parsed.testCoverageThreshold).toBe(80);
      expect(parsed.typecheck).toBe("tsc --noEmit");
      expect(parsed.lint).toBe("eslint src/");
      expect(parsed.lintFix).toBe("eslint src/ --fix");
      expect(parsed.formatCheck).toBe("prettier --check src/");
      expect(parsed.formatFix).toBe("prettier --write src/");
      expect(parsed.build).toBe("tsc -b");
    });

    it("returns empty commands when sections are missing", () => {
      const md = `# QA Static Tools\n\nNothing here yet.\n`;
      const parsed = parseQAStaticTools(md);
      expect(parsed.test).toBeNull();
      expect(parsed.lint).toBeNull();
    });

    it("handles alternate section names", () => {
      const md = `## Unit Tests
Command: \`vitest run\`
`;
      const parsed = parseQAStaticTools(md);
      expect(parsed.test).toBe("vitest run");
    });

    it("extracts coverage threshold when on its own line", () => {
      const md = `## Test Runner
Command: \`jest\`
Coverage threshold: 75%
`;
      const parsed = parseQAStaticTools(md);
      expect(parsed.testCoverageThreshold).toBe(75);
    });

    it("ignores empty templates", () => {
      const parsed = parseQAStaticTools("");
      expect(parsed.test).toBeNull();
      expect(parsed.lint).toBeNull();
    });
  });

  describe("aggregateQAResults", () => {
    it("returns allPassed=true when every command passed", () => {
      const results: QARunResult[] = [
        { command: "a", exitCode: 0, stdout: "", stderr: "" },
        { command: "b", exitCode: 0, stdout: "", stderr: "" },
      ];
      const out = aggregateQAResults(results);
      expect(out.allPassed).toBe(true);
      expect(out.failures).toEqual([]);
      expect(out.passes).toHaveLength(2);
    });

    it("returns allPassed=false and lists failures", () => {
      const results: QARunResult[] = [
        { command: "a", exitCode: 0, stdout: "", stderr: "" },
        { command: "b", exitCode: 1, stdout: "out", stderr: "bad" },
        { command: "c", exitCode: 2, stdout: "", stderr: "" },
      ];
      const out = aggregateQAResults(results);
      expect(out.allPassed).toBe(false);
      expect(out.failures).toHaveLength(2);
      expect(out.failures[0]?.command).toBe("b");
      expect(out.failures[1]?.command).toBe("c");
    });

    it("treats undefined exitCode as failure", () => {
      const results: QARunResult[] = [
        { command: "a", exitCode: undefined, stdout: "", stderr: "" },
      ];
      const out = aggregateQAResults(results);
      expect(out.allPassed).toBe(false);
    });

    it("handles empty input", () => {
      const out = aggregateQAResults([]);
      expect(out.allPassed).toBe(true);
      expect(out.failures).toEqual([]);
      expect(out.passes).toEqual([]);
    });
  });

  describe("summariseResults", () => {
    it("returns a short human-readable summary", () => {
      const results: QARunResult[] = [
        { command: "a", exitCode: 0, stdout: "", stderr: "" },
        { command: "b", exitCode: 1, stdout: "out", stderr: "bad" },
      ];
      const summary = summariseResults(results);
      expect(summary).toContain("1");
      expect(summary).toContain("2");
    });
  });

  it("typecheck: QACommands has the expected shape", () => {
    const c: QACommands = {
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
    expect(c.test).toBeNull();
  });

  describe("formatFailureFeedback", () => {
    it("returns a pass message when all results passed", () => {
      const results: QARunResult[] = [
        { command: "a", exitCode: 0, stdout: "ok", stderr: "" },
      ];
      expect(formatFailureFeedback(results)).toContain("passed");
    });

    it("includes each failed command and its output", () => {
      const results: QARunResult[] = [
        { command: "lint", exitCode: 0, stdout: "", stderr: "" },
        { command: "test", exitCode: 1, stdout: "FAIL", stderr: "boom" },
      ];
      const out = formatFailureFeedback(results);
      expect(out).toContain("test");
      expect(out).not.toContain("lint");
      expect(out).toContain("FAIL");
      expect(out).toContain("boom");
    });

    it("truncates very long output", () => {
      const long = "x".repeat(8000);
      const results: QARunResult[] = [
        { command: "a", exitCode: 1, stdout: long, stderr: "" },
      ];
      const out = formatFailureFeedback(results);
      expect(out).toContain("[truncated");
    });
  });

  describe("runQACommands", () => {
    it("runs a passing command and reports exitCode 0", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-qa-"));
      const out = runQACommands(dir, {
        test: "true",
        testCoverageThreshold: null,
        typecheck: null,
        lint: null,
        lintFix: null,
        formatCheck: null,
        formatFix: null,
        importSort: null,
        build: null,
      });
      expect(out).toHaveLength(1);
      expect(out[0]?.exitCode).toBe(0);
    });

    it("runs a failing command and reports non-zero exitCode", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-qa-"));
      const out = runQACommands(dir, {
        test: "false",
        testCoverageThreshold: null,
        typecheck: null,
        lint: null,
        lintFix: null,
        formatCheck: null,
        formatFix: null,
        importSort: null,
        build: null,
      });
      expect(out).toHaveLength(1);
      expect(out[0]?.exitCode).not.toBe(0);
    });

    it("skips commands that are null", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-qa-"));
      const out = runQACommands(dir, {
        test: null,
        testCoverageThreshold: null,
        typecheck: null,
        lint: null,
        lintFix: null,
        formatCheck: null,
        formatFix: null,
        importSort: null,
        build: null,
      });
      expect(out).toEqual([]);
    });

    it("captures stdout from a real command", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-qa-"));
      const out = runQACommands(dir, {
        test: "echo hello-qa-test",
        testCoverageThreshold: null,
        typecheck: null,
        lint: null,
        lintFix: null,
        formatCheck: null,
        formatFix: null,
        importSort: null,
        build: null,
      });
      expect(out[0]?.stdout).toContain("hello-qa-test");
    });
  });

  describe("checkRedPhase", () => {
    it("returns null when typecheck passes and tests fail (correct red phase)", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-redphase-"));
      const violation = checkRedPhase(dir, {
        ...NO_COMMANDS,
        typecheck: "true",
        test: "false",
      });
      expect(violation).toBeNull();
    });

    it("returns null when neither typecheck nor test is configured", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-redphase-"));
      const violation = checkRedPhase(dir, NO_COMMANDS);
      expect(violation).toBeNull();
    });

    it("reports typecheck-failed when the type-checker exits non-zero", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-redphase-"));
      const violation = checkRedPhase(dir, {
        ...NO_COMMANDS,
        typecheck: "false",
        test: "false",
      });
      expect(violation?.kind).toBe("typecheck-failed");
    });

    it("reports tests-passed when the test runner exits zero", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-redphase-"));
      const violation = checkRedPhase(dir, {
        ...NO_COMMANDS,
        typecheck: "true",
        test: "true",
      });
      expect(violation?.kind).toBe("tests-passed");
    });

    it("checks typecheck before test, reporting typecheck-failed even if tests also pass", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-redphase-"));
      const violation = checkRedPhase(dir, {
        ...NO_COMMANDS,
        typecheck: "false",
        test: "true",
      });
      expect(violation?.kind).toBe("typecheck-failed");
    });

    it("skips the typecheck check when not configured, and still checks tests", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-redphase-"));
      const violation = checkRedPhase(dir, {
        ...NO_COMMANDS,
        test: "true",
      });
      expect(violation?.kind).toBe("tests-passed");
    });

    it("skips the test check when not configured, and still checks typecheck", () => {
      const dir = mkdtempSync(join(tmpdir(), "fe-redphase-"));
      const violation = checkRedPhase(dir, {
        ...NO_COMMANDS,
        typecheck: "false",
      });
      expect(violation?.kind).toBe("typecheck-failed");
    });
  });
});
