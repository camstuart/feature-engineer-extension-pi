/**
 * Feature Engineer — Pi extension entry point.
 *
 * Registers the single `/feature` slash command with four sub-modes:
 *   - `/feature`             → start or resume the workflow
 *   - `/feature approve`     → advance the current step
 *   - `/feature reject X`    → re-run the current skill with feedback
 *   - `/feature status`      → show the current workflow position
 *
 * State persists across sessions via `pi.appendEntry("fe-state", ...)` and
 * is restored on every `session_start`.
 *
 * Each skill runs in its own fresh Pi session — no skill inherits the
 * conversation history of a previous skill.
 */

import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import {
  isHardBlocked,
  OPTIONAL_HEADINGS,
  validateArtifactContent,
  type ArtifactValidationResult,
} from "./approve-gate.js";
import { readArtifact, readConfigFile, readTemplate } from "./files.js";
import { checkInitialisation, ensureFeatureEngineerDir } from "./init.js";
import {
  artifactFileDiskName,
  configFileDiskName,
  CONFIG_FILES,
  featureDirPath,
  getNextFeatureId,
  toSlug,
} from "./paths.js";
import { latestState } from "./persistence.js";
import {
  formatConcernSummary,
  isRejectionSource,
  isValidSeverity,
  parseConcernCounts,
  parseRequirementMode,
  parseSubcommand,
  REQUIREMENT_MODE_CHOICES,
  SEVERITY_NEXT_STEP,
  type Severity,
} from "./routing.js";
import { resolvePackageLayout, seedTemplates } from "./seeding.js";
import { runAnalyseCodebase } from "./skills/analyse-codebase.js";
import { runGithub } from "./skills/github.js";
import { runImplBuilder } from "./skills/impl-builder.js";
import { runImplPlanning } from "./skills/impl-planning.js";
import { runReadFeatures } from "./skills/read-features.js";
import { runReqGathering } from "./skills/req-gathering.js";
import { runReviewCompletion } from "./skills/review-completion.js";
import { runTechDesign } from "./skills/tech-design.js";
import { runTestBuilder } from "./skills/test-builder.js";
import { runTestPlanning } from "./skills/test-planning.js";
import {
  type FeatureState,
  type FeatureStep,
  FEATURE_STEPS,
  nextRequirementVersion,
  stepDisplayName,
} from "./state.js";
import { VERSION } from "./version.js";
import {
  configureRateLimit,
  DEFAULT_CONFIG as RATE_LIMIT_DEFAULT,
  registerRateLimitListener,
} from "./rate-limit.js";

/**
 * Suggested completions for `/feature ...` arguments.
 *
 * `reject` takes free-form feedback, so we don't surface a description
 * hint for it (the user needs to type their actual feedback, not a
 * canned option).
 */
const FEATURE_SUBCOMMAND_ITEMS: readonly AutocompleteItem[] = [
  {
    value: "approve",
    label: "approve",
    description: "Approve the current step and advance to the next.",
  },
  {
    value: "reject",
    label: "reject",
    description: "Re-run the current design step with feedback (req-gathering, tech-design, test-planning, impl-planning).",
  },
  {
    value: "status",
    label: "status",
    description: "Show the current workflow position and version.",
  },
];

export default function (pi: ExtensionAPI): void {
  // Rate-limit gate: track provider rate-limit headers and pause
  // between stages when usage is at or below the configured threshold.
  registerRateLimitListener(pi);

  pi.on("session_start", (_event, ctx) => {
    // Restore the most recent fe-state from this session's branch. The
    // handler is idempotent — if no state exists, currentState stays null.
    const restored = latestState(ctx.sessionManager.getBranch());
    currentState = restored;
  });

  pi.on("before_agent_start", (event, _ctx) => {
    // Inject a short workflow-context reminder into the system prompt when
    // a feature-engineer workflow is active. The reminder helps the LLM
    // stay focused on the current skill's task and not advance past the
    // approval gate. Appended (not prepended) so we sit at the end of
    // whatever the runtime has already assembled from other extensions.
    if (currentState === null) return;
    if (currentState.step === "done") return;

    const header =
      `\n\n<!-- feature-engineer-context -->\n` +
      `You are inside a Feature Engineer workflow.\n` +
      `Feature: ${padIdFor(currentState.featureId)} — ${currentState.featureSlug}\n` +
      `Current step: ${stepDisplayName(currentState.step)}\n` +
      `Stay focused on this step's task. Do NOT advance past the current\n` +
      `step's approval gate — the user advances the workflow explicitly via\n` +
      `/feature approve` +
      (isRejectionSource(currentState.step)
        ? ` or /feature reject <feedback>`
        : "") +
      `. When you finish the step's deliverable, end your turn.\n` +
      `<!-- /feature-engineer-context -->`;

    return { systemPrompt: event.systemPrompt + header };
  });

  // CLI flag: --feature-rate-limit-threshold <pct>
  // Default 10 — sleep when 90% of the rate-limit window is used.
  // Set to 0 to disable the gate entirely.
  pi.registerFlag("feature-rate-limit-threshold", {
    description: `Feature Engineer: rate-limit gate threshold (sleep when remaining ≤ this percent). Default ${RATE_LIMIT_DEFAULT.thresholdPct}; set to 0 to disable.`,
    type: "string",
    default: String(RATE_LIMIT_DEFAULT.thresholdPct),
  });
  {
    const raw = pi.getFlag("feature-rate-limit-threshold") as string | undefined;
    const parsed = raw !== undefined ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 100) {
      configureRateLimit({ thresholdPct: parsed });
    }
  }

  // CLI flag: --feature-rate-limit-poll <seconds>
  // How often the gate updates its status heartbeat during a wait.
  // Default 1800 (30 min). Lower values give a more responsive
  // status bar at the cost of more status updates.
  pi.registerFlag("feature-rate-limit-poll", {
    description: `Feature Engineer: rate-limit poll interval in seconds. Default ${Math.round(RATE_LIMIT_DEFAULT.pollIntervalMs / 1000)}.`,
    type: "string",
    default: String(Math.round(RATE_LIMIT_DEFAULT.pollIntervalMs / 1000)),
  });
  {
    const raw = pi.getFlag("feature-rate-limit-poll") as string | undefined;
    const parsed = raw !== undefined ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      configureRateLimit({ pollIntervalMs: parsed * 1000 });
    }
  }

  // CLI flag: --feature-rate-limit-buffer <seconds>
  // How long to wait AFTER the rate-limit window resets before
  // retrying. Default 60 (1 minute). Some providers stagger the
  // renewal of their quota counters, so retrying right at the
  // boundary can still hit a 429. The buffer gives the window
  // time to fully refresh.
  pi.registerFlag("feature-rate-limit-buffer", {
    description: `Feature Engineer: rate-limit post-reset buffer in seconds. Default ${Math.round(RATE_LIMIT_DEFAULT.postResetBufferMs / 1000)}.`,
    type: "string",
    default: String(Math.round(RATE_LIMIT_DEFAULT.postResetBufferMs / 1000)),
  });
  {
    const raw = pi.getFlag("feature-rate-limit-buffer") as string | undefined;
    const parsed = raw !== undefined ? Number.parseFloat(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) {
      configureRateLimit({ postResetBufferMs: parsed * 1000 });
    }
  }

  pi.registerCommand("feature", {
    description: `Feature Engineer v${VERSION}: start or advance the spec-driven feature workflow. Subcommands: (none) | approve | reject <feedback> | status`,
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const filtered = FEATURE_SUBCOMMAND_ITEMS.filter((i) =>
        i.value.startsWith(prefix.toLowerCase()),
      );
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      // Seed bundled templates into the user's global templates dir on
      // first run. Idempotent — existing customised templates are preserved.
      // Resolved once per command from the running module's URL.
      const layout = resolvePackageLayout(import.meta.url);
      const seedResult = seedTemplates(layout, homedir());
      if (seedResult.copied.length > 0 && ctx.hasUI) {
        ctx.ui.notify(
          `Feature Engineer v${VERSION}: seeded ${seedResult.copied.length} default templates into ${seedResult.targetDir}. Customise them freely.`,
          "info",
        );
      }

      const sub = parseSubcommand(args);

      switch (sub.kind) {
        case "status":
          return handleStatus(ctx);
        case "approve":
          return handleApprove(ctx);
        case "reject":
          return handleReject(ctx, sub.feedback);
        case "run":
          return handleRun(ctx);
      }
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory state (reconstructed from session on every session_start)
// ─────────────────────────────────────────────────────────────────────────────

let currentState: FeatureState | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// Subcommand handlers
// ─────────────────────────────────────────────────────────────────────────────

function handleStatus(ctx: CmdCtx): void {
  if (!ctx.hasUI) {
    // Non-interactive mode: emit a single line so users running
    // `pi -p "/feature status"` can still see the result.
    if (currentState === null) {
      ctx.ui.notify(`Feature Engineer v${VERSION}: no active workflow.`, "info");
      return;
    }
    const s = currentState;
    ctx.ui.notify(
      `Feature Engineer v${VERSION} — ${s.featureSlug} (${padIdFor(s.featureId)}): ${stepDisplayName(s.step)}`,
      "info",
    );
    return;
  }

  if (currentState === null) {
    ctx.ui.notify(
      `Feature Engineer v${VERSION}: no active workflow. Run /feature to start.`,
      "info",
    );
    return;
  }
  const s = currentState;
  ctx.ui.notify(
    `Feature Engineer v${VERSION} — ${s.featureSlug} (${padIdFor(s.featureId)}): ${stepDisplayName(s.step)}`,
    "info",
  );
}

async function handleApprove(ctx: CmdCtx): Promise<void> {
  if (currentState === null) {
    ctx.ui.notify(
      "Feature Engineer: no active workflow. Run /feature first.",
      "warning",
    );
    return;
  }

  const cur = currentState;

  // Recovery branch: Implementation Builder paused after QA exhaustion.
  // `/feature approve` re-runs it as-is (clearing the flag) rather than
  // advancing to review-completion. Satisfies PRD §9.8's
  // "approve to retry the impl as-is" UX.
  if (cur.step === "impl-builder" && cur.implFailed === true) {
    currentState = { ...cur, implFailed: false };
    await runImplBuilderWithRecovery(ctx, currentState);
    return;
  }

  const nextStep = nextLinearStep(cur.step);
  if (nextStep === null) {
    ctx.ui.notify("Feature Engineer: workflow already complete.", "info");
    return;
  }

  const gateOutcome = await runApproveGate(ctx, cur);
  if (gateOutcome === "blocked") return;

  // If advancing INTO concern-severity, the prompt runs inline (handled by
  // advanceTo which dispatches to promptConcernSeverity for that step).
  await advanceTo(ctx, nextStep);
}

/** A single artifact file to validate at an interactive artifact-producing step. */
interface ArtifactCheckTarget {
  /** Human-readable label for notify messages, e.g. "01-requirement.md". */
  label: string;
  content: string | null;
  templateContent: string | null;
  optionalHeadings: readonly string[];
}

/**
 * Resolves the artifact file(s) that must be validated before advancing out
 * of `state.step`. Returns `[]` for steps that don't produce a user-reviewed
 * artifact (the gate is then a no-op) — this covers both the automated
 * skills (test-builder, impl-builder, review-completion, github) and any
 * non-artifact UI steps.
 *
 * All file I/O happens here (not in `approve-gate.ts`, which stays a pure,
 * ctx-free validation module).
 */
function artifactsForStep(
  cwd: string,
  state: FeatureState,
): ArtifactCheckTarget[] {
  switch (state.step) {
    case "analyse-codebase":
      return CONFIG_FILES.map((name) => ({
        label: configFileDiskName(name),
        content: readConfigFile(cwd, name),
        templateContent: readTemplate("config", name),
        optionalHeadings: OPTIONAL_HEADINGS[name] ?? [],
      }));
    case "req-gathering":
      return [
        {
          label: artifactFileDiskName("requirement") ?? "01-requirement.md",
          content: readArtifact(cwd, state.featureId, state.featureSlug, "requirement"),
          templateContent: readTemplate("artifact", "requirement"),
          optionalHeadings: OPTIONAL_HEADINGS["requirement"] ?? [],
        },
      ];
    case "tech-design":
      return [
        {
          label:
            artifactFileDiskName("technical-architecture") ??
            "03-technical-architecture.md",
          content: readArtifact(
            cwd,
            state.featureId,
            state.featureSlug,
            "technical-architecture",
          ),
          templateContent: readTemplate("artifact", "technical-architecture"),
          optionalHeadings: OPTIONAL_HEADINGS["technical-architecture"] ?? [],
        },
      ];
    case "test-planning":
      return [
        {
          label:
            artifactFileDiskName("technical-plan-testing") ??
            "04-technical-plan-testing.md",
          content: readArtifact(
            cwd,
            state.featureId,
            state.featureSlug,
            "technical-plan-testing",
          ),
          templateContent: readTemplate("artifact", "technical-plan-testing"),
          optionalHeadings: OPTIONAL_HEADINGS["technical-plan-testing"] ?? [],
        },
      ];
    case "impl-planning":
      return [
        {
          label:
            artifactFileDiskName("technical-plan-implementation") ??
            "05-technical-plan-implementation.md",
          content: readArtifact(
            cwd,
            state.featureId,
            state.featureSlug,
            "technical-plan-implementation",
          ),
          templateContent: readTemplate(
            "artifact",
            "technical-plan-implementation",
          ),
          optionalHeadings:
            OPTIONAL_HEADINGS["technical-plan-implementation"] ?? [],
        },
      ];
    default:
      return [];
  }
}

/**
 * Deterministic approve-gate check for interactive artifact-producing steps.
 * Runs immediately before `advanceTo` in `handleApprove`.
 *
 * Returns `"blocked"` when the workflow must NOT advance (hard block on
 * missing/placeholder/AI-comment content, or the user cancelled at the
 * missing-headings confirmation) — the caller must `return` without calling
 * `advanceTo`. Returns `"proceed"` otherwise (clean artifact, or the user
 * confirmed "Approve anyway" past a missing-headings warning, or the step
 * doesn't produce a gated artifact at all).
 */
async function runApproveGate(
  ctx: CmdCtx,
  state: FeatureState,
): Promise<"blocked" | "proceed"> {
  const targets = artifactsForStep(ctx.cwd, state);
  if (targets.length === 0) return "proceed";

  const results = targets.map((target) => ({
    target,
    result: validateArtifactContent(
      target.content,
      target.templateContent,
      target.optionalHeadings,
    ),
  }));

  const blocked = results.filter(({ result }) => isHardBlocked(result));
  if (blocked.length > 0) {
    const detail = blocked
      .map(({ target, result }) => describeHardBlock(target.label, result))
      .join("\n");
    ctx.ui.notify(
      `Feature Engineer: approve blocked — fix the following before advancing:\n${detail}`,
      "error",
    );
    return "blocked";
  }

  const withMissingHeadings = results.filter(
    ({ result }) => result.missingHeadings.length > 0,
  );
  if (withMissingHeadings.length > 0) {
    const detail = withMissingHeadings
      .map(
        ({ target, result }) =>
          `${target.label}: missing headings: ${result.missingHeadings.join(", ")}`,
      )
      .join("\n");

    if (!ctx.hasUI) {
      // Non-interactive automation can't be prompted — warn and proceed
      // rather than blocking indefinitely on a condition it cannot resolve.
      ctx.ui.notify(
        `Feature Engineer: warning — ${detail}\n(non-interactive mode: proceeding automatically)`,
        "warning",
      );
      return "proceed";
    }

    ctx.ui.notify(`Feature Engineer: warning —\n${detail}`, "warning");
    const choice = await ctx.ui.select("Advance anyway?", [
      "Approve anyway",
      "Cancel — let me fix it",
    ]);
    if (choice === undefined || choice.startsWith("Cancel")) {
      ctx.ui.notify(
        "Feature Engineer: approve cancelled. Fix the missing headings and re-run /feature approve.",
        "info",
      );
      return "blocked";
    }
  }

  return "proceed";
}

/** Renders a hard-block detail line naming the file and its specific issue(s). */
function describeHardBlock(
  label: string,
  result: ArtifactValidationResult,
): string {
  if (result.missing) {
    return `- ${label}: file is missing.`;
  }
  const issues: string[] = [];
  if (result.placeholderLines.length > 0) {
    issues.push(
      `contains placeholder marker(s): ${result.placeholderLines.map((l) => `\`${l}\``).join(", ")}`,
    );
  }
  if (result.aiCommentLines.length > 0) {
    issues.push(
      `contains AI comment(s): ${result.aiCommentLines.map((l) => `\`${l}\``).join(", ")}`,
    );
  }
  return `- ${label}: ${issues.join("; ")}`;
}

/**
 * Shared post-impl-builder advancement: advances to review-completion on
 * success and sets `implFailed: true` on QA exhaustion. Used by both the
 * initial run and the `/feature approve` recovery path.
 */
async function autoAdvanceFromImplBuilder(
  ctx: CmdCtx,
  completedState: FeatureState,
): Promise<void> {
  const next = nextLinearStep(completedState.step);
  if (next === null) {
    ctx.ui.notify("Feature Engineer: workflow complete!", "info");
    return;
  }
  await advanceTo(ctx, next);
}

async function runImplBuilderWithRecovery(
  ctx: CmdCtx,
  state: FeatureState,
): Promise<void> {
  const result = await runImplBuilder(ctx, state, {
    onComplete: async (completedState) => {
      await autoAdvanceFromImplBuilder(ctx, completedState);
    },
  });
  if (result.outcome === "qa-exhausted") {
    // Park the workflow at impl-builder with the failure flag set so the
    // user can recover via `/feature approve` (retry as-is) or
    // `/feature reject <feedback>` (loop back to impl-planning).
    currentState = { ...state, implFailed: true };
  }
}

async function handleReject(ctx: CmdCtx, feedback: string | null): Promise<void> {
  if (currentState === null) {
    ctx.ui.notify(
      "Feature Engineer: no active workflow. Run /feature first.",
      "warning",
    );
    return;
  }

  // Recovery branch: Implementation Builder paused after QA exhaustion.
  // `/feature reject <feedback>` loops back to impl-planning with the user's
  // feedback so they can revise the plan. Strict — only allowed when the
  // `implFailed` flag is set; mid-impl rejections are out of scope.
  // Satisfies PRD §9.8's "reject to retry from the planning step" UX.
  if (currentState.step === "impl-builder") {
    if (currentState.implFailed !== true) {
      ctx.ui.notify(
        `Feature Engineer: /feature reject is only valid at impl-builder after QA exhaustion (currently at ${stepDisplayName(currentState.step)}).`,
        "error",
      );
      return;
    }
    if (feedback === null) {
      ctx.ui.notify(
        "Feature Engineer: /feature reject requires feedback. Try: /feature reject <your feedback>",
        "error",
      );
      return;
    }
    const updated: FeatureState = {
      ...currentState,
      step: "impl-planning",
      rejectionFeedback: feedback,
      implFailed: false,
      reviewConcerns: undefined,
    };
    currentState = updated;
    await runImplPlanning(ctx, updated);
    return;
  }

  if (!isRejectionSource(currentState.step)) {
    ctx.ui.notify(
      `Feature Engineer: /feature reject is only valid at a design skill step (currently at ${stepDisplayName(currentState.step)}).`,
      "error",
    );
    return;
  }
  if (feedback === null) {
    ctx.ui.notify(
      "Feature Engineer: /feature reject requires feedback. Try: /feature reject <your feedback>",
      "error",
    );
    return;
  }

  const updated: FeatureState = {
    ...currentState,
    rejectionFeedback: feedback,
    // A new requirement draft will be written — bump the version so the
    // downstream Technical Design prompt references "requirement.md vN+1"
    // (per PRD §7.3). Only `req-gathering` rejections change the
    // requirement itself; rejections at tech-design / test-planning /
    // impl-planning re-draft later artifacts and the requirement is
    // unchanged, so the version stays.
    requirementVersion: nextRequirementVersion(currentState),
    // Human rejection feedback is a distinct channel from review concerns
    // (per the review-quality-loop spec) — always clear on reject.
    reviewConcerns: undefined,
  };
  currentState = updated;
  await runSkillForStep(ctx, updated);
}

async function handleRun(ctx: CmdCtx): Promise<void> {
  // Resume existing workflow first.
  if (currentState !== null) {
    if (currentState.step === "concern-severity") {
      await promptConcernSeverity(ctx, currentState);
      return;
    }
    if (currentState.step === "review-concerns-gate") {
      await promptReviewConcernsGate(ctx, currentState);
      return;
    }
    if (currentState.step === "new-or-existing") {
      await handleNewOrExisting(ctx);
      return;
    }
    if (currentState.step === "done") {
      ctx.ui.notify("Feature Engineer: workflow already complete.", "info");
      return;
    }
    // Defensive: if a persisted req-gathering state predates the
    // `requirementMode` field (or the user reloaded from a branch where
    // the field is missing), ask for the mode now instead of letting
    // the skill runner silently default. The PRD treats the mode as a
    // required per-requirement user decision — not an optional field
    // with a default.
    if (
      currentState.step === "req-gathering" &&
      currentState.requirementMode === undefined
    ) {
      const mode = await promptRequirementMode(ctx);
      if (mode === null) {
        ctx.ui.notify(
          "Feature Engineer: requirement-mode selection cancelled.",
          "info",
        );
        return;
      }
      currentState = { ...currentState, requirementMode: mode };
    }
    await runSkillForStep(ctx, currentState);
    return;
  }

  // No prior state: check init and start the appropriate path.
  ensureFeatureEngineerDir(ctx.cwd);
  const initStatus = checkInitialisation(ctx.cwd);
  if (!initStatus.ready) {
    // Project not initialised — kick off Analyse Codebase.
    await runAnalyseCodebase(ctx, initStatus);
    return;
  }
  // Project initialised: ask user new or existing.
  await handleNewOrExisting(ctx);
}

// ─────────────────────────────────────────────────────────────────────────────
// UI-only steps (handled inline, no new session)
// ─────────────────────────────────────────────────────────────────────────────

async function handleNewOrExisting(ctx: CmdCtx): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(
      `Feature Engineer v${VERSION}: /feature requires interactive mode (TUI or RPC) to choose new vs existing feature.`,
      "warning",
    );
    return;
  }

  const choice = await ctx.ui.select("Feature Engineer:", [
    "New feature",
    "Existing feature",
  ]);
  if (choice === undefined) {
    ctx.ui.notify("Feature Engineer: selection cancelled.", "info");
    return;
  }

  if (choice === "New feature") {
    const title = await ctx.ui.input(
      "Feature title:",
      "e.g. User authentication with email OTP",
    );
    if (title === undefined || title.trim().length === 0) {
      ctx.ui.notify("Feature Engineer: no title provided. Cancelled.", "info");
      return;
    }
    const slug = toSlug(title);
    if (slug.length === 0) {
      ctx.ui.notify(
        "Feature Engineer: title produced an empty slug. Use letters/digits.",
        "error",
      );
      return;
    }
    const id = getNextFeatureId(safeReaddir(ctx.cwd));
    const featureDir = featureDirPath(ctx.cwd, id, slug);
    const mode = await promptRequirementMode(ctx);
    if (mode === null) {
      ctx.ui.notify("Feature Engineer: requirement-mode selection cancelled.", "info");
      return;
    }
    const newState: FeatureState = {
      featureId: id,
      featureSlug: slug,
      featureDir,
      step: "req-gathering",
      requirementMode: mode,
      requirementVersion: 1,
    };
    currentState = newState;
    await runReqGathering(ctx, newState);
    return;
  }

  // EXISTING branch — delegate to the dedicated Read Features skill.
  const result = await runReadFeatures(ctx);
  if (result === null) return;
  const featureDir = featureDirPath(ctx.cwd, result.picked.id, result.picked.slug);
  const mode = await promptRequirementMode(ctx);
  if (mode === null) {
    ctx.ui.notify("Feature Engineer: requirement-mode selection cancelled.", "info");
    return;
  }
  const newState: FeatureState = {
    featureId: result.picked.id,
    featureSlug: result.picked.slug,
    featureDir,
    step: "req-gathering",
    requirementMode: mode,
    requirementVersion: 1,
  };
  currentState = newState;
  await runReqGathering(ctx, newState);
}

/**
 * Asks the user whether they want to write down a clear requirement
 * (`direct`) or brainstorm with the agent (`vague`) for the upcoming
 * requirement-gathering session. Returns `null` if the user cancels.
 *
 * Returns `null` immediately in non-UI modes (print/json) — the caller
 * should treat that as "user cancelled" and abort cleanly.
 */
async function promptRequirementMode(
  ctx: CmdCtx,
): Promise<FeatureState["requirementMode"] | null> {
  if (!ctx.hasUI) {
    return null;
  }
  const choice = await ctx.ui.select(
    "How well-defined is this requirement?",
    [...REQUIREMENT_MODE_CHOICES],
  );
  return parseRequirementMode(choice);
}

/**
 * Prompts the user for review-concern severity, then advances immediately
 * to the appropriate target skill (tech-design or impl-builder).
 */
async function promptConcernSeverity(ctx: CmdCtx, state: FeatureState): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(
      `Feature Engineer v${VERSION}: cannot prompt for review-concern severity in non-interactive mode. Re-run /feature in TUI or RPC mode.`,
      "warning",
    );
    return;
  }

  const concerns = readConcernsContent(state);
  const counts = parseConcernCounts(concerns);
  const recommended = counts.recommendedSeverity;
  const other: Severity = recommended === "ARCHITECTURAL" ? "MINOR" : "ARCHITECTURAL";

  ctx.ui.notify(`Feature Engineer: ${formatConcernSummary(counts)}`, "info");

  const choice = await ctx.ui.select(
    "Review concerns found. Severity?",
    [`${recommended} (recommended)`, other],
  );
  if (choice === undefined) {
    ctx.ui.notify(
      "Feature Engineer: severity selection cancelled. Re-run /feature to retry.",
      "info",
    );
    return;
  }
  // The recommended option is displayed with a " (recommended)" UI suffix
  // (see the `select` call above); strip it to recover the underlying
  // `Severity` value before validating.
  const cleaned = choice.replace(/\s*\(recommended\)$/, "");
  if (!isValidSeverity(cleaned)) {
    ctx.ui.notify(`Feature Engineer: invalid severity "${choice}".`, "error");
    return;
  }
  const severity: Severity = cleaned;
  const nextStep = SEVERITY_NEXT_STEP[severity];
  // Bypass `advanceTo` here — it unconditionally clears `reviewConcerns`,
  // which would defeat the purpose of routing them into the next skill.
  // This mirrors how `handleReject` builds `updated` directly and calls
  // `runSkillForStep` for its own state-carrying re-runs.
  const updated: FeatureState = {
    ...state,
    step: nextStep,
    rejectionFeedback: undefined,
    reviewConcerns: concerns ?? undefined,
  };
  currentState = updated;
  await runSkillForStep(ctx, updated);
}

/**
 * Human-in-the-loop gate after Review Completion.
 *
 * This gate is only reached when `06-review-concerns-to-address.md` has at
 * least one concern — the caller in `runSkillForStep`'s "review-completion"
 * case auto-advances straight to `github` (skipping this gate entirely)
 * when the parsed concern count is zero. When this gate IS shown, the user
 * sees a summary of the concerns file (line count of non-empty concern
 * entries) and explicitly chooses:
 *
 *   - "Address concerns" → advance to `concern-severity` (which itself
 *      prompts for ARCHITECTURAL/MINOR and routes to tech-design or
 *      impl-builder).
 *   - "Skip — go to GitHub" → advance directly to `github`.
 *
 * Cancellation leaves the workflow parked at this gate so a subsequent
 * `/feature` resumes here.
 */
async function promptReviewConcernsGate(ctx: CmdCtx, state: FeatureState): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify(
      `Feature Engineer v${VERSION}: cannot prompt for review-concerns gate in non-interactive mode. Re-run /feature in TUI or RPC mode.`,
      "warning",
    );
    return;
  }

  const concerns = readConcernsContent(state);
  const summary = summariseConcerns(concerns);

  ctx.ui.notify(
    `Feature Engineer: review complete for ${padIdFor(state.featureId)} — ${state.featureSlug}. ${summary}`,
    "info",
  );

  const choice = await ctx.ui.select(
    "Review concerns? (review 06-review-concerns-to-address.md on disk)",
    ["Address concerns — choose severity next", "Skip — go to GitHub"],
  );
  if (choice === undefined) {
    ctx.ui.notify(
      "Feature Engineer: review-concerns gate cancelled. Re-run /feature to retry.",
      "info",
    );
    return;
  }

  if (choice.startsWith("Address concerns")) {
    await advanceTo(ctx, "concern-severity");
    return;
  }
  if (choice.startsWith("Skip")) {
    await advanceTo(ctx, "github");
    return;
  }
  ctx.ui.notify(`Feature Engineer: unexpected gate choice "${choice}".`, "error");
}

/**
 * Render a short human-readable summary of the review-concerns file.
 * Returns a one-line string suitable for an inline notify before the
 * user is prompted to choose severity.
 */
function summariseConcerns(content: string | null): string {
  if (content === null) return "no concerns file found.";
  return formatConcernSummary(parseConcernCounts(content));
}

// ─────────────────────────────────────────────────────────────────────────────
// Skill dispatch (used by advance + rerun + handleRun resume)
// ─────────────────────────────────────────────────────────────────────────────

async function advanceTo(ctx: CmdCtx, nextStep: FeatureStep): Promise<void> {
  if (currentState === null) {
    ctx.ui.notify("Feature Engineer: lost workflow state.", "error");
    return;
  }
  const updated: FeatureState = {
    ...currentState,
    step: nextStep,
    rejectionFeedback: undefined,
    reviewConcerns: undefined,
  };
  currentState = updated;

  if (nextStep === "done") {
    ctx.ui.notify("Feature Engineer: workflow complete!", "info");
    return;
  }
  if (nextStep === "concern-severity") {
    await promptConcernSeverity(ctx, updated);
    return;
  }
  if (nextStep === "review-concerns-gate") {
    await promptReviewConcernsGate(ctx, updated);
    return;
  }
  if (nextStep === "new-or-existing") {
    await handleNewOrExisting(ctx);
    return;
  }
  await runSkillForStep(ctx, updated);
}

async function runSkillForStep(ctx: CmdCtx, state: FeatureState): Promise<void> {
  // Automated skills auto-advance to the next step via onComplete.
  const autoAdvance = async (completedState: FeatureState): Promise<void> => {
    const next = nextLinearStep(completedState.step);
    if (next === null) {
      ctx.ui.notify("Feature Engineer: workflow complete!", "info");
      return;
    }
    await advanceTo(ctx, next);
  };

  switch (state.step) {
    case "req-gathering":
      await runReqGathering(ctx, state);
      return;
    case "tech-design":
      await runTechDesign(ctx, state);
      return;
    case "test-planning":
      await runTestPlanning(ctx, state);
      return;
    case "impl-planning":
      await runImplPlanning(ctx, state);
      return;
    case "test-builder":
      await runTestBuilder(ctx, state, { onComplete: autoAdvance });
      return;
    case "impl-builder":
      // Runs the orchestrator-driven QA loop. On `qa-exhausted`, parks the
      // state at impl-builder with `implFailed: true` so handleApprove /
      // handleReject can recover. On success, auto-advances to
      // review-completion via the shared advance wrapper.
      await runImplBuilderWithRecovery(ctx, state);
      return;
    case "review-completion":
      // After review: parse 06-review-concerns-to-address.md. If it has
      // zero concerns, auto-advance straight to GitHub (the gate is
      // skipped). Otherwise hand the user the human-in-the-loop Review
      // Concerns? gate, where they explicitly choose whether to advance to
      // GitHub or proceed to the Concern Severity classification.
      await runReviewCompletion(ctx, state, {
        onComplete: async (completedState) => {
          const concerns = readConcernsContent(completedState);
          const counts = parseConcernCounts(concerns);
          if (counts.total === 0) {
            ctx.ui.notify(
              `Feature Engineer: review clean for ${padIdFor(completedState.featureId)} — ${completedState.featureSlug}. Advancing to GitHub.`,
              "info",
            );
            await advanceTo(ctx, "github");
            return;
          }
          await advanceTo(ctx, "review-concerns-gate");
        },
      });
      return;
    case "github":
      await runGithub(ctx, state, { onComplete: autoAdvance });
      return;
    case "analyse-codebase":
      ctx.ui.notify(
        "Feature Engineer: unexpected analyse-codebase step. Run /feature to retry.",
        "error",
      );
      return;
    case "init-check":
    case "new-or-existing":
    case "review-concerns-gate":
    case "concern-severity":
    case "done":
      // Handled inline by handleRun / advanceTo.
      return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function nextLinearStep(step: FeatureStep): FeatureStep | null {
  const idx = FEATURE_STEPS.indexOf(step);
  if (idx < 0 || idx === FEATURE_STEPS.length - 1) return null;
  return FEATURE_STEPS[idx + 1] ?? null;
}

function padIdFor(id: number): string {
  return String(id).padStart(3, "0");
}

function safeReaddir(cwd: string): string[] {
  try {
    return readdirSync(join(cwd, ".feature-engineer"));
  } catch {
    return [];
  }
}

/**
 * Reads the review-concerns file for a completed review pass. Returns null
 * if the file is missing or unreadable. The "review-completion" onComplete
 * handler in `runSkillForStep` uses the parsed count of this content to
 * decide between `github` (zero concerns — auto-advance, gate skipped) and
 * `review-concerns-gate` (one or more concerns — user is shown the gate and
 * explicitly chooses). `concern-severity` is not decided directly from this
 * content; it's only reached after the user picks "Address concerns" at
 * that gate.
 */
function readConcernsContent(state: FeatureState): string | null {
  // Use the prefix-aware filename so this stays in sync with the path
  // helpers in paths.ts. The on-disk name is the only thing the
  // prefix changes — the directory layout is unchanged.
  const filename = artifactFileDiskName("review-concerns-to-address");
  if (filename === null) return null;
  try {
    return readFileSync(join(state.featureDir, filename), "utf8");
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Local type aliases
// ─────────────────────────────────────────────────────────────────────────────

type CmdCtx = Parameters<Parameters<ExtensionAPI["registerCommand"]>[1]["handler"]>[1];
