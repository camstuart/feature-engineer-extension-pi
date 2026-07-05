/**
 * Feature Engineer workflow state.
 *
 * The state model is intentionally explicit: every step is named, the
 * ordering is fixed, and transitions are pure functions so they can be
 * tested without touching the Pi runtime.
 *
 * Design notes:
 *  - Each "skill" step is a single fresh Pi session. The LLM in that session
 *    produces an artifact (or code) and either asks the user to approve
 *    (interactive skills) or runs to completion (automated skills).
 *  - Each "ui" step (init-check, new-or-existing, concern-severity) is
 *    handled by the orchestrator using `ctx.ui.*` — no separate session.
 *  - Approval IS the transition: when the user types `/feature approve`
 *    while in a skill step, the state advances to the next step.
 */

/** All steps in the Feature Engineer workflow, in canonical execution order. */
export const FEATURE_STEPS = [
  "init-check",
  "analyse-codebase",
  "new-or-existing",
  "req-gathering",
  "tech-design",
  "test-planning",
  "impl-planning",
  "test-builder",
  "impl-builder",
  "review-completion",
  "review-concerns-gate",
  "concern-severity",
  "github",
  "done",
] as const;

/** Steps that are part of project-level initialisation (before per-feature work). */
export const INITIALIZATION_STEPS = [
  "init-check",
  "analyse-codebase",
  "new-or-existing",
] as const satisfies readonly FeatureStep[];

/** Terminal step. No transitions out. */
export const TERMINAL_STEP = "done" as const satisfies FeatureStep;

export const ALL_STEPS = FEATURE_STEPS;

export const INITIAL_STEP: FeatureStep = "init-check";

export type FeatureStep = (typeof FEATURE_STEPS)[number];

/**
 * Requirement-gathering mode chosen by the user before the req-gathering
 * skill starts. Controls whether the LLM does discovery Q&A (`vague`) or
 * captures an already-defined requirement (`direct`).
 */
export type RequirementMode = "direct" | "vague";

/** All valid RequirementMode values, useful for iteration in tests. */
export const REQUIREMENT_MODES: readonly RequirementMode[] = ["direct", "vague"];

/** Type-guard: returns true when `value` is a valid RequirementMode. */
export function isRequirementMode(value: unknown): value is RequirementMode {
  return value === "direct" || value === "vague";
}

/** Persisted workflow state for the active feature. */
export interface FeatureState {
  /** Sequence number (1, 2, 3, ...). 0 during analyse-codebase (before any feature exists). */
  featureId: number;
  /** Hyphen-case slug derived from the feature title. */
  featureSlug: string;
  /** Absolute path to the per-feature directory. */
  featureDir: string;
  /** Current workflow step. */
  step: FeatureStep;
  /** Set when the user rejected the previous step; read by the next invocation. */
  rejectionFeedback?: string;
  /**
   * How the user wants to run requirement gathering. Set by the orchestrator
   * via a `ui.select` before the req-gathering skill starts. Once set, it
   * round-trips through persistence and is preserved across `/feature reject`
   * loops so a rejected requirement re-runs in the same mode.
   */
  requirementMode?: RequirementMode;
  /**
   * Version number of the current `01-requirement.md` for this feature.
   * Starts at `1` when the feature is created and is bumped to `2`, `3`, …
   * each time the user rejects at `req-gathering` (a new requirement draft
   * is being written). The Technical Design prompt reads this to populate
   * the `{{VERSION}}` placeholder in `technical-architecture.md` —
   * "requirement.md vN" — so the architecture is traceable back to the
   * exact requirement it was authored against (per PRD §7.3).
   *
   * Rejections at `tech-design`, `test-planning`, or `impl-planning` do NOT
   * bump the version (they re-draft later artifacts, not the requirement).
   * The `ARCHITECTURAL` concern-severity branch (which loops back to
   * `tech-design`) also leaves the version unchanged.
   */
  requirementVersion?: number;
  /**
   * True when Implementation Builder exhausted its QA-retry budget and the
   * workflow is paused at `step: "impl-builder"`. While set:
   *   - `/feature approve` re-runs Implementation Builder as-is (no advance).
   *   - `/feature reject <feedback>` loops back to `impl-planning` with the
   *     user's feedback so the plan can be revised.
   * Cleared on either recovery path.
   *
   * Satisfies PRD §9.8: "the workflow pauses so the user can review the
   * plan, edit it, and `/feature reject` to retry from the planning step,
   * or `/feature approve` to retry the impl as-is."
   */
  implFailed?: boolean;
  /**
   * Outstanding review concerns to address, set by `promptConcernSeverity`
   * in `index.ts` immediately before routing to `tech-design` or
   * `impl-builder` after the user picks a MINOR/ARCHITECTURAL severity at
   * the concern-severity gate. The routed skill's prompt builder(s)
   * (`buildImplBuilderPrompt`, `buildTechDesignPhase1Prompt`/`Phase2Prompt`)
   * consume this to render a `## Review Concerns To Address` block.
   *
   * Survives exactly the one skill invocation it was set for: it is
   * always cleared (`undefined`) on any subsequent `/feature reject`
   * (per the review-quality-loop spec's "human rejection feedback remains
   * distinct" requirement — the `rejectionFeedback` and `reviewConcerns`
   * channels never coexist in a single prompt) and on any generic forward
   * advance via `advanceTo`.
   */
  reviewConcerns?: string;
}

/**
 * Default happy-path transition: advance by one step.
 *
 * Rejection loops are computed by `nextStepFor` in `persistence.ts` — that
 * helper also handles the `concern-severity` branch.
 *
 * Returns `null` when the workflow is complete (`done`).
 */
export function getNextStep(current: FeatureStep): FeatureStep | null {
  const i = FEATURE_STEPS.indexOf(current);
  if (i < 0 || i === FEATURE_STEPS.length - 1) return null;
  return FEATURE_STEPS[i + 1] ?? null;
}

/**
 * Computes the new `requirementVersion` after a `/feature reject` at the
 * given step. Only rejections at `req-gathering` change the requirement
 * itself, so only those bump the version. Rejections at later design
 * steps (tech-design, test-planning, impl-planning) re-draft downstream
 * artifacts and leave the requirement alone, so the version stays.
 *
 * Returns the new version (≥ 1). When `state.requirementVersion` is
 * undefined, treats the current draft as version 1 and bumps to 2.
 */
export function nextRequirementVersion(
  state: Pick<FeatureState, "step" | "requirementVersion">,
): number | undefined {
  if (state.step !== "req-gathering") return state.requirementVersion;
  return (state.requirementVersion ?? 1) + 1;
}

/**
 * Human-readable step name for session titles and notifications.
 *
 * Stable, sentence-case, suitable for direct display to users.
 */
const STEP_DISPLAY_NAMES: Record<FeatureStep, string> = {
  "init-check": "Initialization check",
  "analyse-codebase": "Analyse codebase",
  "new-or-existing": "Select feature",
  "req-gathering": "Requirement gathering",
  "tech-design": "Technical design",
  "test-planning": "Testing and QA planning",
  "impl-planning": "Implementation planning",
  "test-builder": "Test builder",
  "impl-builder": "Implementation builder",
  "review-completion": "Review completion",
  "review-concerns-gate": "Review concerns?",
  "concern-severity": "Review concern severity",
  github: "GitHub",
  done: "Complete",
};

export function stepDisplayName(step: FeatureStep): string {
  return STEP_DISPLAY_NAMES[step];
}

export function isInitializationStep(step: FeatureStep): boolean {
  return (INITIALIZATION_STEPS as readonly FeatureStep[]).includes(step);
}

/** Steps the orchestrator handles via `ctx.ui.*` rather than a new session. */
const UI_STEPS: ReadonlySet<FeatureStep> = new Set([
  "init-check",
  "new-or-existing",
  "review-concerns-gate",
  "concern-severity",
]);

export function isUiStep(step: FeatureStep): boolean {
  return UI_STEPS.has(step);
}

/**
 * Interactive skills: user reviews the generated document before advancing.
 * The skill prompt instructs the LLM to use `ui.confirm()` to gate progression.
 */
const INTERACTIVE_STEPS: ReadonlySet<FeatureStep> = new Set([
  "analyse-codebase",
  "req-gathering",
  "tech-design",
  "test-planning",
  "impl-planning",
]);

export function isInteractiveSkill(step: FeatureStep): boolean {
  return INTERACTIVE_STEPS.has(step);
}

/**
 * Automated skills: run without a user approval gate. The orchestrator drives
 * them via `ctx.waitForIdle()` and the skill prompt is written for autonomous
 * execution.
 */
const AUTOMATED_STEPS: ReadonlySet<FeatureStep> = new Set([
  "test-builder",
  "impl-builder",
  "review-completion",
  "github",
]);

export function isAutomatedSkill(step: FeatureStep): boolean {
  return AUTOMATED_STEPS.has(step);
}

const REVIEW_STEPS: ReadonlySet<FeatureStep> = new Set([
  "review-completion",
  "review-concerns-gate",
  "concern-severity",
]);

export function isReviewTriggerStep(step: FeatureStep): boolean {
  return REVIEW_STEPS.has(step);
}

/**
 * Returns true when the current step expects a file artifact to exist on
 * disk before advancing.
 */
const ARTIFACT_PRODUCING_STEPS: ReadonlySet<FeatureStep> = new Set([
  "analyse-codebase",
  "req-gathering",
  "tech-design",
  "test-planning",
  "impl-planning",
  "test-builder",
  "impl-builder",
  "review-completion",
  "github",
]);

export function producesArtifact(step: FeatureStep): boolean {
  return ARTIFACT_PRODUCING_STEPS.has(step);
}
