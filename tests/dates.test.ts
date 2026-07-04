import { describe, expect, it } from "vitest";
import { todayIso } from "@/dates";

describe("dates", () => {
  it("returns YYYY-MM-DD format", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("matches today's date", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(todayIso()).toBe(expected);
  });

  it("honours an injected Date", () => {
    const d = new Date("2026-06-19T15:00:00Z");
    // We can't easily test timezone independence here, but we can confirm it
    // produces a YYYY-MM-DD string from the supplied Date.
    const result = todayIso(d);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.startsWith("2026")).toBe(true);
  });
});
