/**
 * Implementation Builder skill prompt builder.
 *
 * Automated skill: executes the implementation tasks in order. The
 * orchestrator runs the QA suite after each LLM turn and re-prompts with
 * the failure output if anything failed (up to 3 attempts total — see
 * `buildImplBuilderRetryPrompt`). The LLM should focus on producing the
 * code; it MAY run QA itself as a sanity check, but the orchestrator's
 * QA pass is the authoritative one.
 */

import type { FeatureState } from "../state.js";
import {
  automatedSkillReminder,
  codeBlock,
  skillHeader,
} from "./common.js";

export interface ImplBuilderPromptInputs {
  architecture: string;
  testPlan: string;
  implPlan: string;
  structure: string;
  techStack: string;
  qaStaticTools: string;
  qaEngineering: string;
  state: FeatureState;
  /** Maximum orchestrator-driven QA retries. Kept for backward-compat; the
   * orchestrator now enforces this itself. */
  maxRetries: number;
}

export function buildImplBuilderPrompt(inputs: ImplBuilderPromptInputs): string {
  const {
    architecture,
    testPlan,
    implPlan,
    structure,
    techStack,
    qaStaticTools,
    qaEngineering,
    state,
  } = inputs;

  const lines: string[] = [
    skillHeader(state, "Implementation Builder"),
    "",
    `You will execute the tasks in \`05-technical-plan-implementation.md\` **in order**. Implement each task, commit per \`06-git-strategy.md\`, and run the static QA tools + test runner as a sanity check after each task. The orchestrator will run the QA suite independently after you finish and re-prompt you with the failure output if anything is still red.`,
    "",
    "## Input Files",
    ...codeBlock("03-technical-architecture.md", architecture),
    ...codeBlock("04-technical-plan-testing.md", testPlan),
    ...codeBlock("05-technical-plan-implementation.md", implPlan),
    ...codeBlock("02-structure.md", structure),
    ...codeBlock("03-tech-stack.md", techStack),
    ...codeBlock("04-qa-static-tools.md", qaStaticTools),
    ...codeBlock("05-qa-engineering.md", qaEngineering),
    "",
    "## Process",
    "",
    "1. Read `05-technical-plan-implementation.md` and identify the first task.",
    "2. Implement that task in the target file(s) listed in the plan. If a test is referenced by name, satisfy it.",
    "3. Optionally run the static QA commands from `04-qa-static-tools.md` and the test runner as a sanity check; the orchestrator re-runs them authoritatively after you finish.",
    "4. Commit the task per `06-git-strategy.md` (commit format, branch conventions, frequency).",
    "5. Move to the next task and repeat from step 2.",
    "6. When all tasks are complete, run the full QA suite one final time to confirm green.",
    "",
    "## Blocked-Task Behaviour",
    "",
    "- If a task is blocked by an external dependency you cannot resolve (missing API key, network failure, conflicting code you cannot reason about), call `ui.notify` with the task number and the block, then end your turn. Do not silently skip tasks or invent assumptions to keep moving.",
    "- Never edit a test file to make a failing test pass. Fix the production code.",
    "- Never use `--force` or `--force-with-lease` on shared branches.",
    "",
    "## Final Message",
    "",
    "When all tasks are complete, your final assistant message must be a short structured summary:",
    "",
    "```",
    "Tasks: <count> complete",
    "Commits: <list of commit hashes or short messages in order>",
    "QA: <pass/fail summary>",
    "Status: DONE | BLOCKED",
    "```",
    "",
    ...automatedSkillReminder(),
    "",
    "Begin with Task 1.",
  ];

  return lines.join("\n");
}

export interface ImplBuilderRetryPromptInputs {
  state: FeatureState;
  /** 1-based attempt number (1 is the initial attempt, 2+ are retries). */
  attempt: number;
  /** Maximum total attempts the orchestrator will allow. */
  maxAttempts: number;
  /** Formatted failure output from the orchestrator's QA pass. */
  failureFeedback: string;
  /** The original implementation plan (re-injected for context after
   *  a fresh session starts). */
  implPlan: string;
}

/**
 * Builds the prompt for a retry attempt. Sent in a NEW session (so the
 * LLM has fresh context), with the failure output from the previous
 * attempt's QA pass as primary input.
 */
export function buildImplBuilderRetryPrompt(inputs: ImplBuilderRetryPromptInputs): string {
  const { state, attempt, maxAttempts, failureFeedback, implPlan } = inputs;
  const isFinal = attempt === maxAttempts;
  const lines: string[] = [
    skillHeader(state, `Implementation Builder — Retry ${attempt}/${maxAttempts}`),
    "",
    `Attempt ${attempt} of ${maxAttempts}${isFinal ? " (FINAL — no further retries)" : ""}.`,
    "",
    "A previous attempt at implementing this feature left the QA suite failing. Your job on this attempt is to make every QA tool pass without editing tests or weakening assertions. Do not re-draft the architecture or the plan; the prior implementation is on disk and you are working against the same `05-technical-plan-implementation.md`.",
    "",
    "## Previous Attempt's QA Failures",
    "",
    "These are the commands that failed and their output. Diagnose root cause from these messages, then fix the production code.",
    "",
    "```",
    failureFeedback,
    "```",
    "",
    "## Implementation Plan (baseline)",
    "",
    "Re-read this to make sure your fix targets the right task(s) and the right file(s).",
    ...codeBlock("05-technical-plan-implementation.md", implPlan),
    "",
    "## Process",
    "",
    "1. Read the QA failure output above and identify the root cause for each failure. Note: multiple failures may share a single root cause.",
    "2. Make the minimum production-code change that resolves the failure. Do not refactor or 'improve' unrelated code.",
    "3. If a test is failing, fix the production code — never edit the test. The implementation plan's `Satisfies tests` lines are the contract.",
    "4. After fixing, run the failing command(s) yourself as a sanity check.",
    "5. If everything is green, end your turn with the standard summary:",
    "",
    "```",
    "Tasks: <count> complete",
    "Commits: <list of commit hashes or short messages in order>",
    "QA: <pass/fail summary>",
    "Status: DONE | BLOCKED",
    "```",
    "",
    "6. If you are blocked (e.g. an external dependency you cannot resolve), call `ui.notify` with the task number and the block, then end your turn with `Status: BLOCKED`. Do not invent workarounds.",
    "",
    ...automatedSkillReminder(),
  ];
  return lines.join("\n");
}
