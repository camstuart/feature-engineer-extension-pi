/**
 * Features-index maintenance.
 *
 * Pure functions for parsing and updating `.feature-engineer/features-index.md`.
 * The orchestrators read the file from disk, call `updateIndex()`, and write
 * the result back.
 */

import { padId } from "./paths.js";

export type FeatureStatus = "COMPLETE" | "IN_PROGRESS" | "BLOCKED" | "DRAFT";

export const KNOWN_STATUSES: readonly FeatureStatus[] = [
  "COMPLETE",
  "IN_PROGRESS",
  "BLOCKED",
  "DRAFT",
];

export interface FeatureIndexEntry {
  id: number;
  slug: string;
  description: string;
  status: FeatureStatus | string;
  date: string;
}

const ROW_PATTERN = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;

/**
 * Parses a single non-header, non-separator table row into a FeatureIndexEntry.
 * Returns null for header rows, separator rows, blank lines, or malformed input.
 */
export function parseIndexLine(line: string): FeatureIndexEntry | null {
  const trimmed = line.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith("|---")) return null;
  if (trimmed.startsWith("| ID |") || /^\|\s*ID\s*\|/i.test(trimmed)) return null;

  const match = ROW_PATTERN.exec(trimmed);
  if (!match) return null;
  const idStr = match[1];
  const slug = match[2];
  const description = match[3];
  const status = match[4];
  const date = match[5];
  if (!idStr || !slug || !description || !status || !date) return null;

  const id = Number.parseInt(idStr, 10);
  if (!Number.isFinite(id)) return null;

  return {
    id,
    slug: slug.trim(),
    description: description.trim(),
    status: status.trim(),
    date: date.trim(),
  };
}

/** Renders a single index table row from an entry. */
export function formatIndexRow(entry: FeatureIndexEntry): string {
  return `| ${padId(entry.id)} | ${entry.slug} | ${entry.description} | ${entry.status} | ${entry.date} |`;
}

/**
 * Renders the full features-index file. If `entries` is empty, includes a
 * "_No features yet_" placeholder row.
 */
export function formatIndexTable(entries: readonly FeatureIndexEntry[]): string {
  const lines: string[] = ["# Features Index", ""];
  if (entries.length === 0) {
    lines.push("_No features yet_");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("| ID | Slug | Description | Status | Date |");
  lines.push("|---|---|---|---|---|");
  for (const e of entries) lines.push(formatIndexRow(e));
  lines.push("");
  return lines.join("\n");
}

/**
 * Reads an existing index file body, applies `change`, and returns the new body.
 *
 * Behaviour:
 *  - If an entry with the same ID exists, it is replaced.
 *  - Otherwise the new entry is appended in ID order.
 *  - If `existing` is empty, a fresh table is created.
 */
export function updateIndex(
  existing: string,
  change: FeatureIndexEntry,
): string {
  const entries: FeatureIndexEntry[] = [];
  for (const line of existing.split(/\r?\n/)) {
    const parsed = parseIndexLine(line);
    if (parsed) entries.push(parsed);
  }

  const idx = entries.findIndex((e) => e.id === change.id);
  if (idx >= 0) entries[idx] = change;
  else {
    entries.push(change);
    entries.sort((a, b) => a.id - b.id);
  }

  return formatIndexTable(entries);
}
