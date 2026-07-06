/**
 * Deterministic approve-gate validation for interactive artifact-producing
 * steps (`analyse-codebase`, `req-gathering`, `tech-design`, `test-planning`,
 * `impl-planning`).
 *
 * Pure functions only — no I/O, no `ExtensionCommandContext`/`ctx` dependency.
 * Callers (currently `index.ts`'s `handleApprove`) read the artifact and
 * template content from disk and pass the strings in here; this module only
 * inspects the text and reports what it finds.
 */

/** Result of validating a single artifact file's content. */
export interface ArtifactValidationResult {
  /** True if the artifact is missing entirely. */
  missing: boolean;
  /** Lines (verbatim, trimmed) containing a `{{` placeholder marker. */
  placeholderLines: string[];
  /** Lines (verbatim, trimmed) that are `<!-- AI: ... -->` comments. */
  aiCommentLines: string[];
  /** Template `##`-level headings absent from the artifact, excluding the optional-heading allowlist. */
  missingHeadings: string[];
}

/**
 * Optional-heading allowlist, keyed by artifact/config name (matching
 * `ArtifactFileName`/`ConfigFileName` string values from `paths.ts`). Headings
 * listed here are excluded from the missing-headings check because they are
 * optional by design (e.g. only relevant when there's an existing
 * architecture to diff against).
 */
export const OPTIONAL_HEADINGS: Record<string, readonly string[]> = {
  "technical-architecture": ["Delta from Existing Architecture"],
};

/** True when the result requires a hard block (missing file, any placeholder, any AI comment). */
export function isHardBlocked(result: ArtifactValidationResult): boolean {
  return (
    result.missing ||
    result.placeholderLines.length > 0 ||
    result.aiCommentLines.length > 0
  );
}

/** True when the result is clean (no hard block, no missing headings). */
export function isClean(result: ArtifactValidationResult): boolean {
  return !isHardBlocked(result) && result.missingHeadings.length === 0;
}

const HEADING_RE = /^##\s+(.+?)\s*$/;

/** Extracts the trimmed text of every `##`-level heading in `content`, in order. */
function extractHeadings(content: string): string[] {
  const out: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    const m = HEADING_RE.exec(line);
    if (m?.[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/**
 * Validates a single artifact file's content against its template's
 * headings.
 *
 * `content === null` means the file is missing/empty (sets `missing: true`,
 * all other fields empty — there's nothing to scan for placeholders if the
 * file doesn't exist).
 *
 * `templateContent === null` means the template itself couldn't be read; in
 * that case `missingHeadings` is always `[]` (nothing to compare against —
 * this should not happen in practice since skills already fail loudly if
 * their template is missing before they'd ever write an artifact, but the
 * validator must not crash if it does).
 */
export function validateArtifactContent(
  content: string | null,
  templateContent: string | null,
  optionalHeadings: readonly string[],
): ArtifactValidationResult {
  if (content === null) {
    return {
      missing: true,
      placeholderLines: [],
      aiCommentLines: [],
      missingHeadings: [],
    };
  }

  const placeholderLines: string[] = [];
  const aiCommentLines: string[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.includes("{{")) placeholderLines.push(line);
    if (line.includes("<!-- AI:")) aiCommentLines.push(line);
  }

  let missingHeadings: string[] = [];
  if (templateContent !== null) {
    const templateHeadings = extractHeadings(templateContent);
    const artifactHeadings = new Set(extractHeadings(content));
    const optionalSet = new Set(optionalHeadings);
    missingHeadings = templateHeadings.filter(
      (h) => !artifactHeadings.has(h) && !optionalSet.has(h),
    );
  }

  return {
    missing: false,
    placeholderLines,
    aiCommentLines,
    missingHeadings,
  };
}
