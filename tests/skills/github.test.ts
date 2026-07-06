/**
 * Runner-level tests for the GitHub skill's deterministic "commits exist"
 * pre-check.
 *
 * The github skill no longer creates branches or commits (Task 9) — the
 * feature branch and all implementation commits are already in place by the
 * time this skill runs. Before starting the LLM session, `runGithub`
 * verifies (via `git-checks.ts`'s `countCommitsSinceBase`) that at least one
 * commit exists on the feature branch relative to the configured base
 * branch. If not, it must notify and cancel WITHOUT ever starting a
 * session — the fake `ctx.newSession` below throws if invoked, so any
 * regression that lets the zero-commits case reach the LLM session fails
 * loudly rather than silently passing.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runGithub } from "@/skills/github";
import { artifactFileDiskName, configFileDiskName, featureDirPath } from "@/paths";
import type { FeatureState } from "@/state";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

function git(cwd: string, args: string[]): void {
  execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
}

const STATE: FeatureState = {
  featureId: 1,
  featureSlug: "foo",
  featureDir: "/unused",
  step: "github",
};

let cwd: string;

/**
 * Fake ctx whose `newSession` throws if ever invoked — proves the LLM
 * session never starts for the zero-commits case. `ui.notify` records calls
 * so tests can assert the anomaly was reported.
 */
function makeFakeCtx(): { ctx: ExtensionCommandContext; notifications: string[] } {
  const notifications: string[] = [];
  const ctx = {
    cwd,
    hasUI: true,
    ui: {
      notify: (message: string, level: string) => {
        notifications.push(`${level}:${message}`);
      },
      setStatus: () => {},
    },
    sessionManager: {
      getSessionFile: () => "/fake/session.jsonl",
    },
    signal: undefined,
    newSession: async () => {
      throw new Error(
        "newSession should never be called when zero commits are found — the LLM session must not start",
      );
    },
  } as unknown as ExtensionCommandContext;
  return { ctx, notifications };
}

function writeInputs(cwd: string, gitStrategyExtra = ""): void {
  const feBase = join(cwd, ".feature-engineer");
  mkdirSync(feBase, { recursive: true });
  writeFileSync(
    join(feBase, configFileDiskName("git-strategy")),
    `# Git Strategy\n\nBranch pattern: \`feature/{slug}\`\nBase branch: \`main\`\n${gitStrategyExtra}`,
  );
  const featDir = featureDirPath(cwd, STATE.featureId, STATE.featureSlug);
  mkdirSync(featDir, { recursive: true });
  writeFileSync(join(featDir, artifactFileDiskName("requirement")!), "requirement content");
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

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "fe-github-skill-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

describe("skills/github — zero-commits pre-check", () => {
  it("cancels and notifies without starting an LLM session when no commits exist on the feature branch", async () => {
    initRepo(cwd);
    git(cwd, ["checkout", "-q", "-b", "feature/foo"]);
    // No new commits relative to main.
    writeInputs(cwd);

    const { ctx, notifications } = makeFakeCtx();
    const result = await runGithub(ctx, STATE);

    expect(result.cancelled).toBe(true);
    expect(notifications.some((n) => n.startsWith("error:") && /no commits/i.test(n))).toBe(true);
  });

  it("proceeds toward starting a session when commits exist on the feature branch", async () => {
    initRepo(cwd);
    git(cwd, ["checkout", "-q", "-b", "feature/foo"]);
    writeFileSync(join(cwd, "a.txt"), "x\n");
    git(cwd, ["add", "."]);
    git(cwd, ["commit", "-q", "-m", "feat: add a"]);
    writeInputs(cwd);

    const { ctx } = makeFakeCtx();
    // The fake ctx's `newSession` throws — that throw propagating out proves
    // `runGithub` genuinely tried to start a session in the has-commits case
    // (as opposed to swallowing the pre-check result unconditionally).
    await expect(runGithub(ctx, STATE)).rejects.toThrow("newSession should never be called");
  });
});
