/**
 * Persistence helpers for `fe-state` session entries.
 *
 * The extension stores its workflow state as `pi.appendEntry("fe-state", state)`
 * — a custom entry that does NOT participate in LLM context. These helpers
 * validate and serialise that data without touching the SessionManager.
 */

import {
  type FeatureState,
  FEATURE_STEPS,
  type FeatureStep,
  isRequirementMode,
} from "./state.js";

export type PersistedFeatureState = FeatureState;

const STEP_SET: ReadonlySet<string> = new Set<string>(FEATURE_STEPS);

/**
 * Returns true if `value` is a well-formed persisted FeatureState.
 *
 * Validation rules:
 *  - Must be a non-null object.
 *  - `featureId` must be a non-negative integer (0 allowed for analyse-codebase).
 *  - `featureSlug` and `featureDir` must be non-empty strings.
 *  - `step` must be a known FeatureStep.
 *  - `rejectionFeedback` (optional) must be a string when present.
 *  - `requirementMode` (optional) must be a valid RequirementMode when present.
 *  - `requirementVersion` (optional) must be a positive integer when present.
 *  - `implFailed` (optional) must be a boolean when present.
 */
export function isPersistedState(value: unknown): value is PersistedFeatureState {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;

  if (typeof v.featureId !== "number" || !Number.isInteger(v.featureId)) return false;
  if (v.featureId < 0) return false;
  if (typeof v.featureSlug !== "string" || v.featureSlug.length === 0) return false;
  if (typeof v.featureDir !== "string" || v.featureDir.length === 0) return false;
  if (typeof v.step !== "string" || !STEP_SET.has(v.step)) return false;

  if (
    "rejectionFeedback" in v &&
    v.rejectionFeedback !== undefined &&
    typeof v.rejectionFeedback !== "string"
  ) {
    return false;
  }

  if (
    "requirementMode" in v &&
    v.requirementMode !== undefined &&
    !isRequirementMode(v.requirementMode)
  ) {
    return false;
  }

  if (
    "requirementVersion" in v &&
    v.requirementVersion !== undefined &&
    (typeof v.requirementVersion !== "number" ||
      !Number.isInteger(v.requirementVersion) ||
      v.requirementVersion < 1)
  ) {
    return false;
  }

  if (
    "implFailed" in v &&
    v.implFailed !== undefined &&
    typeof v.implFailed !== "boolean"
  ) {
    return false;
  }

  return true;
}

/** Converts a live FeatureState into a plain object suitable for `appendEntry`. */
export function encodeState(state: FeatureState): PersistedFeatureState {
  const out: PersistedFeatureState = {
    featureId: state.featureId,
    featureSlug: state.featureSlug,
    featureDir: state.featureDir,
    step: state.step,
  };
  if (state.rejectionFeedback !== undefined) {
    out.rejectionFeedback = state.rejectionFeedback;
  }
  if (state.requirementMode !== undefined) {
    out.requirementMode = state.requirementMode;
  }
  if (state.requirementVersion !== undefined) {
    out.requirementVersion = state.requirementVersion;
  }
  if (state.implFailed !== undefined) {
    out.implFailed = state.implFailed;
  }
  return out;
}

/**
 * Minimal shape of an entry the SessionManager returns. We only depend on the
 * `type`, `customType`, and `data` fields — this lets us type the helper
 * without importing the full SessionEntry union.
 */
export interface MinimalEntryLike {
  type: unknown;
  customType?: unknown;
  data?: unknown;
}

export const FE_STATE_CUSTOM_TYPE = "fe-state";

/**
 * Walks the active session branch and returns the most recent valid
 * `fe-state` entry's decoded state, or null if none exists.
 *
 * The branch is walked in array order, so callers should pass entries from
 * the SessionManager in chronological order. The LAST valid match wins.
 */
export function latestState(
  entries: readonly MinimalEntryLike[],
): PersistedFeatureState | null {
  let latest: PersistedFeatureState | null = null;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.type !== "custom") continue;
    if (entry.customType !== FE_STATE_CUSTOM_TYPE) continue;
    if (isPersistedState(entry.data)) latest = entry.data;
  }
  return latest;
}

export type Severity = "ARCHITECTURAL" | "MINOR";

/**
 * Compute the next step from the current state, factoring in rejection
 * feedback loops and concern-severity routing.
 *
 * Rules:
 *  - If `current === "concern-severity"`:
 *      - ARCHITECTURAL → tech-design (re-run from Technical Design)
 *      - MINOR → impl-builder (re-run from Implementation Builder)
 *      - null/unknown → null (the orchestrator should not advance without severity)
 *  - If `current === "github"`: → done
 *  - If `feedback` is non-empty AND current is a "rejection source" step:
 *      - Re-run the same skill (loop back).
 *  - Otherwise: advance by one step.
 *
 * "Rejection source" steps are the interactive skill steps where the user
 * can choose to reject and ask for regeneration:
 *  - req-gathering → req-gathering (regenerate requirement)
 *  - tech-design → tech-design
 *  - test-planning → test-planning
 *  - impl-planning → impl-planning
 */
const REJECTION_LOOPS: Partial<Record<FeatureStep, FeatureStep>> = {
  "req-gathering": "req-gathering",
  "tech-design": "tech-design",
  "test-planning": "test-planning",
  "impl-planning": "impl-planning",
};

export function nextStepFor(
  current: FeatureStep,
  feedback: string | undefined,
  severity: Severity | null,
): FeatureStep | null {
  if (current === "concern-severity") {
    if (severity === "ARCHITECTURAL") return "tech-design";
    if (severity === "MINOR") return "impl-builder";
    return null;
  }
  if (current === "github") return "done";

  if (feedback && feedback.trim().length > 0) {
    const loop = REJECTION_LOOPS[current];
    if (loop) return loop;
  }

  const i = FEATURE_STEPS.indexOf(current);
  if (i < 0 || i === FEATURE_STEPS.length - 1) return null;
  return FEATURE_STEPS[i + 1] ?? null;
}
