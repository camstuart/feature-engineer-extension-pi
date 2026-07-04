import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runReadFeatures } from "@/skills/read-features";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "fe-read-features-"));
  // Set up one existing feature with a requirement.md
  const feBase = join(cwd, ".feature-engineer");
  mkdirSync(join(feBase, "feature-001-user-auth"), { recursive: true });
  writeFileSync(
    join(feBase, "feature-001-user-auth", "01-requirement.md"),
    "# User Auth\n\nSome requirement here.\n",
  );
  mkdirSync(join(feBase, "feature-002-payments"), { recursive: true });
  writeFileSync(
    join(feBase, "feature-002-payments", "01-requirement.md"),
    "# Payments\n",
  );
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

interface FakeUi {
  calls: Array<{ method: string; args: unknown[] }>;
  notify(message: string, level: "info" | "warning" | "error"): void;
  select: (prompt: string, options: readonly string[]) => Promise<string | undefined>;
  input: (prompt: string, placeholder?: string) => Promise<string | undefined>;
  confirm: (prompt: string) => Promise<boolean | undefined>;
  setStatus: (key: string, text: string | undefined) => void;
}

function makeFakeCtx(opts: { hasUI?: boolean; select?: string | undefined } = {}): ExtensionCommandContext {
  const hasUI = opts.hasUI ?? true;
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const ui: FakeUi = {
    calls,
    notify(message: string, level: "info" | "warning" | "error") {
      calls.push({ method: "notify", args: [message, level] });
    },
    select: async (): Promise<string | undefined> => opts.select,
    input: async () => undefined,
    confirm: async () => undefined,
    setStatus: () => {},
  };
  return {
    cwd,
    hasUI,
    ui: ui as unknown as ExtensionCommandContext["ui"],
    sessionManager: {
      getSessionFile: () => "/fake/session.jsonl",
      getBranch: () => [],
    },
    waitForIdle: vi.fn(),
    newSession: vi.fn(),
    signal: undefined,
  } as unknown as ExtensionCommandContext;
}

describe("skills/read-features", () => {
  it("returns the selected feature from a populated project", async () => {
    const ctx = makeFakeCtx({ select: "002 — payments" });
    const result = await runReadFeatures(ctx);
    expect(result).not.toBeNull();
    expect(result?.picked.id).toBe(2);
    expect(result?.picked.slug).toBe("payments");
  });

  it("returns null and notifies when no features exist", async () => {
    const empty = mkdtempSync(join(tmpdir(), "fe-read-features-empty-"));
    try {
      const ctx = makeFakeCtx({ select: undefined });
      (ctx as { cwd: string }).cwd = empty;
      const result = await runReadFeatures(ctx);
      expect(result).toBeNull();
      const flat = JSON.stringify(ctx.ui);
      expect(flat).toContain("No existing features found");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("returns null when the user cancels (select returns undefined)", async () => {
    const ctx = makeFakeCtx({ select: undefined });
    const result = await runReadFeatures(ctx);
    expect(result).toBeNull();
  });

  it("returns null and warns in non-interactive mode", async () => {
    const ctx = makeFakeCtx({ hasUI: false, select: undefined });
    const result = await runReadFeatures(ctx);
    expect(result).toBeNull();
  });
});
