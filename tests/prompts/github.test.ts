import { describe, expect, it } from "vitest";
import { buildGithubPrompt } from "@/prompts/github";

const GIT_STRATEGY = "# Git Strategy\n\nfeature/<slug> branches, conventional commits";
const REQUIREMENT = "# Requirement: X\n\nUser-facing summary of feature.";

const BASE_STATE = {
  featureId: 7,
  featureSlug: "user-login",
  featureDir: "/x",
  step: "github" as const,
};

const BASE_INPUTS = {
  gitStrategy: GIT_STRATEGY,
  requirement: REQUIREMENT,
  featuresIndexPath: "/x/.feature-engineer/features-index.md",
  state: BASE_STATE,
  completionDate: "2024-12-31",
  ghAvailable: true,
};

describe("prompts/github", () => {
  it("inlines the input files", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toContain(GIT_STRATEGY);
    expect(prompt).toContain(REQUIREMENT);
  });

  it("instructs the agent to follow git-strategy.md", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toContain("git-strategy.md");
    expect(prompt).toMatch(/exactly/i);
  });

  it("uses the automated skill reminder (no approval gate)", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toContain("automated skill");
    expect(prompt).not.toMatch(/Architecture approved/i);
  });

  it("tells the agent to update features-index.md", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toContain("features-index.md");
    expect(prompt).toContain("COMPLETE");
  });

  it("includes the completion date in the index row", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toContain("2024-12-31");
  });

  it("uses the ghAvailable flag to decide whether to mention gh", () => {
    const withGh = buildGithubPrompt({ ...BASE_INPUTS, ghAvailable: true });
    expect(withGh).toMatch(/gh.*installed/i);

    const withoutGh = buildGithubPrompt({ ...BASE_INPUTS, ghAvailable: false });
    expect(withoutGh).toMatch(/NOT.*available/i);
    expect(withoutGh).toMatch(/gh not available/);
  });

  it("forbids --force and editing tests to pass", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toMatch(/--force/);
    expect(prompt).toMatch(/Never edit a test file/);
  });

  it("specifies a final structured summary message", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toContain("Branch:");
    expect(prompt).toContain("Commits:");
    expect(prompt).toContain("PR:");
    expect(prompt).toContain("Index:");
    expect(prompt).toMatch(/DONE \| BLOCKED/);
  });

  it("instructs the agent to verify the commit with git log -1", () => {
    const prompt = buildGithubPrompt(BASE_INPUTS);
    expect(prompt).toContain("git log -1");
  });
});