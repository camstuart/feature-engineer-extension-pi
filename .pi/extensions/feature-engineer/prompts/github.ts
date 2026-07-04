/**
 * GitHub skill prompt builder.
 *
 * Automated skill: creates a feature branch, commits per the project's git
 * strategy, pushes, and updates features-index.md. PR creation is gated on
 * whether the `gh` CLI is available — the orchestrator detects this and
 * passes the boolean to the prompt.
 */

import type { FeatureState } from "../state.js";
import {
  automatedSkillReminder,
  codeBlock,
  skillHeader,
} from "./common.js";
import { padId } from "../paths.js";

export interface GithubPromptInputs {
  gitStrategy: string;
  requirement: string;
  featuresIndexPath: string;
  state: FeatureState;
  /** ISO date (YYYY-MM-DD) used when updating features-index. */
  completionDate: string;
  /** True if `gh --version` returned exit 0 in the orchestrator. */
  ghAvailable: boolean;
}

export function buildGithubPrompt(inputs: GithubPromptInputs): string {
  const {
    gitStrategy,
    requirement,
    featuresIndexPath,
    state,
    completionDate,
    ghAvailable,
  } = inputs;
  const idLabel = padId(state.featureId);

  const lines: string[] = [
    skillHeader(state, "GitHub"),
    "",
    `You will wrap up feature **${idLabel}** (${state.featureSlug}) by following the project's git strategy exactly, then updating the features index.`,
    "",
    `## \`gh\` CLI availability`,
    "",
    ghAvailable
      ? "The orchestrator has confirmed that the `gh` CLI is installed. You may use `gh pr create` if the project's git strategy calls for a PR."
      : "The orchestrator has confirmed that the `gh` CLI is **NOT** available. Skip PR creation and note in your final message that the user can open one manually.",
    "",
    "## Output Paths",
    `- Update features index: \`${featuresIndexPath}\``,
    "",
    "## Input Files",
    ...codeBlock("06-git-strategy.md", gitStrategy),
    ...codeBlock("01-requirement.md", requirement),
    "",
    "## Process",
    "",
    "1. **Branch**: create and check out a feature branch per the strategy (e.g. `feature/<slug>`). Use `git checkout -b` or follow the exact pattern from `06-git-strategy.md`.",
    "2. **Commit**: stage the changes and commit using the project's commit message format from `06-git-strategy.md`. Include the feature slug and a short description. After `git commit`, verify with `git log -1` that the commit landed. If it did not, stop and report the failure to the orchestrator.",
    "3. **Push**: push the branch to origin. If the push is rejected, stop and report — do not retry with destructive flags.",
    "4. **PR**: if `gh` is available AND the strategy calls for a PR, open one with the required title format and labels from `06-git-strategy.md`. Skip if either condition is false.",
    "5. **Update index**: append a new row to `features-index.md` using the exact format below. Replace `<one-line description>` with the first non-blank line of `01-requirement.md` (or a 5-10 word summary if that line is a heading).",
    "",
    "## Features Index Row Format",
    "",
    "The row goes at the bottom of the existing table. Use this exact column layout:",
    "",
    "```",
    `| ${idLabel} | ${state.featureSlug} | <one-line description> | COMPLETE | ${completionDate} |`,
    "```",
    "",
    "If no table exists yet in `features-index.md`, create one with a single header row before appending:",
    "",
    "```",
    "| ID | Slug | Summary | Status | Date |",
    "|---|---|---|---|---|",
    "```",
    "",
    "## Safety Constraints",
    "",
    "- Never use `--force` or `--force-with-lease` on shared branches (anything other than your own feature branch).",
    "- Never edit a test file or modify QA tool configuration to make a failing check pass.",
    "- If any git step fails (branch exists, push rejected, hook failure), report the failure to the orchestrator via `ui.notify` and stop. Do not silently retry destructive operations.",
    "",
    "## Final Message",
    "",
    "When complete, your final assistant message must be a short structured summary:",
    "",
    "```",
    "Branch: <name>",
    "Commits: <count>",
    "PR: <URL or 'none (gh not available)' or 'skipped per 06-git-strategy.md'>",
    "Index: <updated|created>",
    "Status: DONE | BLOCKED",
    "```",
    "",
    ...automatedSkillReminder(),
    "",
    "When complete, end your turn. The extension will mark the workflow as done.",
  ];

  return lines.join("\n");
}