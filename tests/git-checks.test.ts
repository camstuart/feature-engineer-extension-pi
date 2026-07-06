import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countCommitsSinceBase,
  ensureBranchCheckedOut,
  parseGitStrategyConfig,
  resolveBranchName,
  runGitStrategyChecks,
  writeGitStrategyFindings,
  type GitStrategyConfig,
} from "@/git-checks";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

function initRepo(cwd: string): void {
  git(cwd, ["init", "-q"]);
  git(cwd, ["config", "user.email", "test@example.com"]);
  git(cwd, ["config", "user.name", "Test"]);
  git(cwd, ["checkout", "-q", "-b", "main"]);
  writeFileSync(join(cwd, "README.md"), "hello\n");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-q", "-m", "chore: init"]);
}

describe("git-checks", () => {
  describe("parseGitStrategyConfig", () => {
    it("extracts all structured lines when present", () => {
      const md = `# Git Strategy

## Branch Strategy
Branch pattern: \`feature/{slug}\`
Base branch: \`develop\`

## Commit Format
Commit pattern: \`^(feat|fix): .+\`
`;
      const config = parseGitStrategyConfig(md);
      expect(config.branchPattern).toBe("feature/{slug}");
      expect(config.commitPattern).toBe("^(feat|fix): .+");
      expect(config.baseBranch).toBe("develop");
    });

    it("defaults branchPattern, commitPattern, baseBranch when absent", () => {
      const md = `# Git Strategy\n\nNo structured lines here.\n`;
      const config = parseGitStrategyConfig(md);
      expect(config.branchPattern).toBe("feature/{slug}");
      expect(config.commitPattern).toBeNull();
      expect(config.baseBranch).toBe("main");
    });

    it("falls back to defaults when a line is malformed (no backticks)", () => {
      const md = `Branch pattern: feature/{slug}\nBase branch: main\n`;
      const config = parseGitStrategyConfig(md);
      expect(config.branchPattern).toBe("feature/{slug}");
      expect(config.baseBranch).toBe("main");
    });
  });

  describe("resolveBranchName", () => {
    it("substitutes {slug} and {id}", () => {
      expect(resolveBranchName("feat/{id}-{slug}", { slug: "email-otp", id: 7 })).toBe(
        "feat/7-email-otp",
      );
    });

    it("substitutes only {slug} when pattern uses just that token", () => {
      expect(resolveBranchName("feature/{slug}", { slug: "email-otp", id: 7 })).toBe(
        "feature/email-otp",
      );
    });

    it("returns the pattern unchanged when neither token is present", () => {
      expect(resolveBranchName("main", { slug: "email-otp", id: 7 })).toBe("main");
    });
  });

  describe("runGitStrategyChecks", () => {
    let cwd: string;

    beforeEach(() => {
      cwd = mkdtempSync(join(tmpdir(), "fe-git-checks-"));
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    it("reports no concern when branch matches the pattern", () => {
      initRepo(cwd);
      git(cwd, ["checkout", "-q", "-b", "feature/email-otp"]);
      writeFileSync(join(cwd, "a.txt"), "x\n");
      git(cwd, ["add", "."]);
      git(cwd, ["commit", "-q", "-m", "feat: add a"]);

      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: null,
        baseBranch: "main",
      };
      const findings = runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 });
      expect(findings).toEqual([]);
    });

    it("reports a branch mismatch concern with expected/actual names", () => {
      initRepo(cwd);
      // Create a branch with a commit, but under the wrong name.
      git(cwd, ["checkout", "-q", "-b", "wrong-branch-name"]);
      writeFileSync(join(cwd, "a.txt"), "x\n");
      git(cwd, ["add", "."]);
      git(cwd, ["commit", "-q", "-m", "feat: add a"]);

      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: null,
        baseBranch: "main",
      };
      const findings = runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain("[MINOR]");
      expect(findings[0]).toContain('"wrong-branch-name"');
      expect(findings[0]).toContain('"feature/email-otp"');
    });

    it("skips commit-existence/format checks silently when base branch is missing", () => {
      initRepo(cwd);
      git(cwd, ["checkout", "-q", "-b", "feature/email-otp"]);
      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: "^feat: .+",
        baseBranch: "does-not-exist",
      };
      const findings = runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 });
      // Branch matches; base branch missing means commit checks are skipped
      // silently (no false "no commits" concern).
      expect(findings).toEqual([]);
    });

    it("reports no concern when commits exist and match the commit pattern", () => {
      initRepo(cwd);
      git(cwd, ["checkout", "-q", "-b", "feature/email-otp"]);
      writeFileSync(join(cwd, "a.txt"), "x\n");
      git(cwd, ["add", "."]);
      git(cwd, ["commit", "-q", "-m", "feat: add a"]);

      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: "^(feat|fix): .+",
        baseBranch: "main",
      };
      const findings = runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 });
      expect(findings).toEqual([]);
    });

    it("reports a concern when a commit subject violates the commit pattern", () => {
      initRepo(cwd);
      git(cwd, ["checkout", "-q", "-b", "feature/email-otp"]);
      writeFileSync(join(cwd, "a.txt"), "x\n");
      git(cwd, ["add", "."]);
      git(cwd, ["commit", "-q", "-m", "wip: broke convention"]);

      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: "^(feat|fix): .+",
        baseBranch: "main",
      };
      const findings = runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain("[MINOR]");
      expect(findings[0]).toContain("wip: broke convention");
    });

    it("skips commit-format checking entirely when no commit pattern is configured", () => {
      initRepo(cwd);
      git(cwd, ["checkout", "-q", "-b", "feature/email-otp"]);
      writeFileSync(join(cwd, "a.txt"), "x\n");
      git(cwd, ["add", "."]);
      git(cwd, ["commit", "-q", "-m", "not a conventional commit at all"]);

      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: null,
        baseBranch: "main",
      };
      const findings = runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 });
      expect(findings).toEqual([]);
    });

    it("reports a concern when no commits exist relative to the base branch", () => {
      initRepo(cwd);
      git(cwd, ["checkout", "-q", "-b", "feature/email-otp"]);
      // No new commits on the feature branch.
      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: null,
        baseBranch: "main",
      };
      const findings = runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 });
      expect(findings).toHaveLength(1);
      expect(findings[0]).toContain("No commits found");
    });

    it("never throws when cwd is not a git repository at all", () => {
      const config: GitStrategyConfig = {
        branchPattern: "feature/{slug}",
        commitPattern: null,
        baseBranch: "main",
      };
      expect(() =>
        runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 }),
      ).not.toThrow();
      expect(runGitStrategyChecks(cwd, config, { slug: "email-otp", id: 1 })).toEqual([]);
    });
  });

  describe("ensureBranchCheckedOut", () => {
    let cwd: string;

    beforeEach(() => {
      cwd = mkdtempSync(join(tmpdir(), "fe-git-checks-ensure-"));
      initRepo(cwd);
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    it("no-ops when the branch is already current", () => {
      const result = ensureBranchCheckedOut(cwd, "main");
      expect(result).toEqual({ ok: true, branch: "main" });
    });

    it("checks out an existing-but-not-current branch without recreating it", () => {
      git(cwd, ["checkout", "-q", "-b", "feature/existing"]);
      writeFileSync(join(cwd, "marker.txt"), "x\n");
      git(cwd, ["add", "."]);
      git(cwd, ["commit", "-q", "-m", "feat: marker commit"]);
      git(cwd, ["checkout", "-q", "main"]);

      const result = ensureBranchCheckedOut(cwd, "feature/existing");
      expect(result).toEqual({ ok: true, branch: "feature/existing" });
      const current = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
      })
        .toString("utf8")
        .trim();
      expect(current).toBe("feature/existing");
      // The prior commit is still there — proves it wasn't recreated.
      expect(existsSync(join(cwd, "marker.txt"))).toBe(true);
    });

    it("creates a brand-new branch when it doesn't exist locally", () => {
      const result = ensureBranchCheckedOut(cwd, "feature/brand-new");
      expect(result).toEqual({ ok: true, branch: "feature/brand-new" });
      const current = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd,
      })
        .toString("utf8")
        .trim();
      expect(current).toBe("feature/brand-new");
    });

    it("returns ok: false with a populated error message on git failure", () => {
      // A branch name containing ".." is invalid per git-check-ref-format,
      // so both the `show-ref` probe and the `checkout -b` attempt fail
      // cleanly without mutating the working tree.
      const result = ensureBranchCheckedOut(cwd, "feature/../etc");
      expect(result.ok).toBe(false);
      expect(result.branch).toBe("feature/../etc");
      expect(result.error).toBeTruthy();
      expect(typeof result.error).toBe("string");
    });
  });

  describe("countCommitsSinceBase", () => {
    let cwd: string;

    beforeEach(() => {
      cwd = mkdtempSync(join(tmpdir(), "fe-git-checks-commitcount-"));
      initRepo(cwd);
    });

    afterEach(() => {
      rmSync(cwd, { recursive: true, force: true });
    });

    it("returns 0 when no commits exist relative to the base branch", () => {
      git(cwd, ["checkout", "-q", "-b", "feature/empty"]);
      expect(countCommitsSinceBase(cwd, "main")).toBe(0);
    });

    it("returns the commit count relative to the base branch", () => {
      git(cwd, ["checkout", "-q", "-b", "feature/with-commits"]);
      writeFileSync(join(cwd, "a.txt"), "x\n");
      git(cwd, ["add", "."]);
      git(cwd, ["commit", "-q", "-m", "feat: add a"]);
      expect(countCommitsSinceBase(cwd, "main")).toBe(1);
    });

    it("returns null when the base branch does not exist", () => {
      expect(countCommitsSinceBase(cwd, "does-not-exist")).toBeNull();
    });
  });

  describe("writeGitStrategyFindings", () => {
    let dir: string;
    let filePath: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "fe-git-checks-write-"));
      filePath = join(dir, "concerns.md");
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    const fixture = `# Review Concerns: Foo

## File Structure
- Some existing concern here.

## Git Strategy
<!-- Populated by the orchestrator's deterministic git-strategy checks -->

## Requirements Coverage
- No concerns.
`;

    it("replaces only the Git Strategy section body when findings are present", () => {
      writeFileSync(filePath, fixture, "utf8");
      writeGitStrategyFindings(filePath, [
        '- [MINOR] Current branch "main" does not match the configured pattern (expected "feature/foo") → checkout or rename to the expected branch name.',
      ]);
      const result = readFileSync(filePath, "utf8");

      expect(result).toContain("## File Structure\n- Some existing concern here.");
      expect(result).toContain("## Requirements Coverage\n- No concerns.");
      expect(result).toContain(
        '## Git Strategy\n- [MINOR] Current branch "main" does not match the configured pattern (expected "feature/foo") → checkout or rename to the expected branch name.\n\n## Requirements Coverage',
      );
      expect(result).not.toContain("Populated by the orchestrator");
    });

    it("writes '- No concerns.' when findings is empty", () => {
      writeFileSync(filePath, fixture, "utf8");
      writeGitStrategyFindings(filePath, []);
      const result = readFileSync(filePath, "utf8");
      expect(result).toContain("## Git Strategy\n- No concerns.\n\n## Requirements Coverage");
    });

    it("no-ops when the file does not exist", () => {
      expect(() => writeGitStrategyFindings(filePath, ["- [MINOR] x → y"])).not.toThrow();
      expect(existsSync(filePath)).toBe(false);
    });

    it("no-ops when the Git Strategy heading is missing", () => {
      const noHeading = `# Review Concerns: Foo\n\n## File Structure\n- No concerns.\n`;
      writeFileSync(filePath, noHeading, "utf8");
      writeGitStrategyFindings(filePath, ["- [MINOR] x → y"]);
      const result = readFileSync(filePath, "utf8");
      expect(result).toBe(noHeading);
    });
  });
});
