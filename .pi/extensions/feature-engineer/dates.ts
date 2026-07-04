/**
 * Date helpers for the Feature Engineer extension.
 *
 * Kept tiny and dependency-free. Tests pin the format to YYYY-MM-DD.
 */

/**
 * Returns today's date as a YYYY-MM-DD string in the local timezone.
 * An optional `Date` argument can be supplied for deterministic testing.
 */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
