/**
 * Routing logic for the Feature Engineer workflow.
 *
 * Pure functions describing which step follows which, including rejection
 * loops and concern-severity routing. Used by the `/feature approve` and
 * `/feature reject` subcommands to compute the next step.
 */

import { type FeatureStep, type RequirementMode, FEATURE_STEPS } from "./state.js";

export type Severity = "ARCHITECTURAL" | "MINOR";

/** Choice labels presented to the user in the requirement-mode `ui.select`. */
export const REQUIREMENT_MODE_CHOICES = [
  "I have a clear requirement — just write it down",
  "I have a rough idea — I want to brainstorm",
] as const;

export const REQUIREMENT_MODE_DIRECT_LABEL = REQUIREMENT_MODE_CHOICES[0];
export const REQUIREMENT_MODE_VAGUE_LABEL = REQUIREMENT_MODE_CHOICES[1];

/**
 * Parses a `ui.select` choice string into a RequirementMode.
 *
 * Returns `null` if the choice is not a recognised label, so the caller
 * can treat unknown input as a cancellation.
 */
export function parseRequirementMode(choice: unknown): RequirementMode | null {
  if (typeof choice !== "string") return null;
  if (choice === REQUIREMENT_MODE_DIRECT_LABEL) return "direct";
  if (choice === REQUIREMENT_MODE_VAGUE_LABEL) return "vague";
  return null;
}

/**
 * Design-skill steps where the user can reject and request regeneration.
 * Rejection loops back to the SAME step (the skill re-runs with feedback).
 */
const REJECTION_SOURCE_STEPS: ReadonlySet<FeatureStep> = new Set([
  "req-gathering",
  "tech-design",
  "test-planning",
  "impl-planning",
]);

/** Map of severity → step to resume from. */
export const SEVERITY_NEXT_STEP: Record<Severity, FeatureStep> = {
  ARCHITECTURAL: "tech-design",
  MINOR: "impl-builder",
};

/** Returns true when the user can reject at this step and request a regenerate. */
export function isRejectionSource(step: FeatureStep): boolean {
  return REJECTION_SOURCE_STEPS.has(step);
}

/**
 * Returns the next step after the workflow completes (used by github skill).
 * Always `done` — kept as a function for future extensibility.
 */
export function terminalNextStep(): FeatureStep {
  return "done";
}

/** Type-guard: returns true when `value` is a valid Severity. */
export function isValidSeverity(value: unknown): value is Severity {
  return value === "ARCHITECTURAL" || value === "MINOR";
}

/**
 * Tolerant tag regex for a single concern bullet line.
 *
 * Matches a leading `-` or `*` bullet marker followed by an `[ARCH]` or
 * `[MINOR]` tag (any case). Whitespace between the marker and the tag is
 * optional so `- [ARCH]` and `-[arch]` both match.
 */
const CONCERN_TAG_RE = /^[-*]\s*\[(ARCH|MINOR)\]/i;

/** Exact text (after trimming) used to mark a section as having no concerns. */
const NO_CONCERNS_LINE = "- No concerns.";

export interface ConcernCounts {
  /** Number of bullets tagged `[ARCH]` (any case). */
  archCount: number;
  /** Number of bullets explicitly tagged `[MINOR]` (any case). */
  minorCount: number;
  /** Bulleted concern lines with no recognisable tag — treated as MINOR for routing. */
  untaggedCount: number;
  /** archCount + minorCount + untaggedCount. */
  total: number;
  /** ARCHITECTURAL when any [ARCH] concern exists, otherwise MINOR. */
  recommendedSeverity: Severity;
}

/**
 * Parses the active review-concerns file content into severity counts.
 *
 * Rules:
 *   - `content === null` (no concerns file found) → all zeros, and
 *     `recommendedSeverity` defaults to "MINOR" (arbitrary — there's
 *     nothing to recommend from, but callers need a Severity value).
 *   - `- No concerns.` lines are not concerns and are ignored.
 *   - Bullet lines (`-` or `* ` marker) that aren't the "No concerns" line
 *     are tagged via a tolerant, case-insensitive `[ARCH]`/`[MINOR]` regex.
 *     Bullets with no recognisable tag count as `untaggedCount` (and are
 *     included in `total`, routed as MINOR).
 *   - Non-bullet lines (headings, prose, blank lines) are ignored.
 */
export function parseConcernCounts(content: string | null): ConcernCounts {
  if (content === null) {
    return {
      archCount: 0,
      minorCount: 0,
      untaggedCount: 0,
      total: 0,
      recommendedSeverity: "MINOR",
    };
  }

  let archCount = 0;
  let minorCount = 0;
  let untaggedCount = 0;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line === NO_CONCERNS_LINE) continue;
    if (!line.startsWith("-") && !line.startsWith("*")) continue;

    const match = CONCERN_TAG_RE.exec(line);
    if (!match) {
      untaggedCount += 1;
      continue;
    }
    const tag = match[1]?.toUpperCase();
    if (tag === "ARCH") archCount += 1;
    else if (tag === "MINOR") minorCount += 1;
  }

  const total = archCount + minorCount + untaggedCount;
  return {
    archCount,
    minorCount,
    untaggedCount,
    total,
    recommendedSeverity: archCount > 0 ? "ARCHITECTURAL" : "MINOR",
  };
}

/**
 * Renders a one-line human-readable summary of parsed concern counts, for
 * display at the review-concerns gate and the concern-severity prompt.
 *
 * Pure and unit-testable — kept here (rather than inline in index.ts)
 * because it has no UI/IO dependency, unlike the rest of index.ts's
 * orchestration glue.
 */
export function formatConcernSummary(counts: ConcernCounts): string {
  if (counts.total === 0) return "No concerns recorded — review is clean.";
  const minorTotal = counts.minorCount + counts.untaggedCount;
  const untaggedNote =
    counts.untaggedCount > 0
      ? ` (${counts.untaggedCount} untagged, counted as MINOR)`
      : "";
  return (
    `${counts.total} concern(s) — ${counts.archCount} ARCH, ${minorTotal} MINOR${untaggedNote}. ` +
    `Recommended route: ${counts.recommendedSeverity}.`
  );
}

export interface ParsedRejectArgs {
  /** Trimmed feedback text, or null when empty. */
  feedback: string | null;
}

/**
 * Parses the raw argument string passed to `/feature reject ...`.
 *
 * Returns `{ feedback: null }` when the input is empty or whitespace only.
 * Otherwise returns the trimmed feedback verbatim — no further interpretation.
 */
export function parseRejectArgs(raw: string): ParsedRejectArgs {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { feedback: null };
  return { feedback: trimmed };
}

/**
 * Parses the subcommand portion of a `/feature ...` invocation.
 *
 * Recognised forms:
 *   - `/feature` → { kind: "run" }
 *   - `/feature approve` → { kind: "approve" }
 *   - `/feature reject <feedback>` → { kind: "reject", feedback }
 *   - `/feature status` → { kind: "status" }
 *
 * Unknown subcommands fall back to `{ kind: "run" }`.
 */
export type FeatureSubcommand =
  | { kind: "run" }
  | { kind: "approve" }
  | { kind: "reject"; feedback: string | null }
  | { kind: "status" };

export function parseSubcommand(args: string): FeatureSubcommand {
  const trimmed = args.trim();
  if (trimmed.length === 0) return { kind: "run" };

  const space = trimmed.search(/\s/);
  const head = space === -1 ? trimmed : trimmed.slice(0, space);
  const tail = space === -1 ? "" : trimmed.slice(space + 1);

  const lower = head.toLowerCase();
  if (lower === "approve") return { kind: "approve" };
  if (lower === "reject") return { kind: "reject", ...parseRejectArgs(tail) };
  if (lower === "status") return { kind: "status" };
  return { kind: "run" };
}

/** Convenience export for tests. */
export { FEATURE_STEPS };
