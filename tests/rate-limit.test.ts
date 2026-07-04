/**
 * Tests for the rate-limit tracker.
 *
 * The tracker is pure logic over response headers plus a small bit of
 * state for "most-restrictive so far". Tests cover header parsing,
 * snapshot selection, gate behaviour (no-op / sleep / abort), and
 * the sleep helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearLatest,
  configureRateLimit,
  DEFAULT_CONFIG,
  formatDuration,
  gateIfNeeded,
  getLatestSnapshot,
  getRateLimitConfig,
  getThrottledCount,
  parseRateLimitHeaders,
  parseResetHeader,
  pollMinimaxUsage,
  pollProviderUsage,
  recordProviderResponse,
  resetAttemptThrottledFlag,
  resetThrottledCount,
  sleep,
  wasLastAttemptThrottled,
  type RateLimitSnapshot,
} from "@/rate-limit";

beforeEach(() => {
  clearLatest();
  resetThrottledCount();
  resetAttemptThrottledFlag();
  configureRateLimit({ ...DEFAULT_CONFIG });
});

afterEach(() => {
  clearLatest();
  resetThrottledCount();
  resetAttemptThrottledFlag();
  configureRateLimit({ ...DEFAULT_CONFIG });
});

describe("rate-limit", () => {
  describe("parseResetHeader", () => {
    it("parses 13-digit epoch ms", () => {
      const ms = 1_700_000_000_000;
      expect(parseResetHeader(String(ms))).toBe(ms);
    });

    it("parses 10-digit epoch seconds", () => {
      const sec = 1_700_000_000;
      expect(parseResetHeader(String(sec))).toBe(sec * 1000);
    });

    it("parses seconds-from-now (small positive number)", () => {
      const before = Date.now();
      const result = parseResetHeader("30");
      const after = Date.now();
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThanOrEqual(before + 30_000);
      expect(result!).toBeLessThanOrEqual(after + 30_000);
    });

    it("parses fractional seconds-from-now", () => {
      const before = Date.now();
      const result = parseResetHeader("1.5");
      expect(result).not.toBeNull();
      expect(result!).toBeGreaterThanOrEqual(before + 1_500);
      expect(result!).toBeLessThanOrEqual(Date.now() + 1_500);
    });

    it("parses ISO 8601 timestamps", () => {
      const iso = "2030-01-01T00:00:00Z";
      const expected = new Date(iso).getTime();
      expect(parseResetHeader(iso)).toBe(expected);
    });

    it("parses HTTP-date format", () => {
      const http = "Wed, 21 Oct 2024 07:28:00 GMT";
      const expected = new Date(http).getTime();
      expect(parseResetHeader(http)).toBe(expected);
    });

    it("returns null for empty / unparseable input", () => {
      expect(parseResetHeader("")).toBeNull();
      expect(parseResetHeader("not a date")).toBeNull();
      expect(parseResetHeader("   ")).toBeNull();
    });

    it("rejects huge seconds-from-now values (likely an epoch)", () => {
      // 100 days in seconds — too large to be a wait, treat as malformed.
      expect(parseResetHeader(String(60 * 60 * 24 * 100))).toBeNull();
    });
  });

  describe("parseRateLimitHeaders", () => {
    it("returns null when no relevant headers are present", () => {
      expect(parseRateLimitHeaders({}, "anthropic", "claude")).toBeNull();
      expect(parseRateLimitHeaders({ "x-foo": "bar" }, "anthropic", "claude")).toBeNull();
    });

    it("prefers retry-after over x-ratelimit-* headers", () => {
      const snapshot = parseRateLimitHeaders(
        {
          "retry-after": "42",
          "x-ratelimit-remaining-requests": "100",
          "x-ratelimit-reset-requests": "10000000000",
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.dimension).toBe("retry-after");
      expect(snapshot!.remainingPct).toBe(0);
      const waitMs = snapshot!.resetAtMs - Date.now();
      expect(waitMs).toBeGreaterThanOrEqual(42_000 - 100);
      expect(waitMs).toBeLessThanOrEqual(42_000 + 100);
    });

    it("parses x-ratelimit-remaining + reset for requests dimension", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snapshot = parseRateLimitHeaders(
        {
          "x-ratelimit-remaining-requests": "8",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-reset-requests": String(futureSec),
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.dimension).toBe("requests");
      expect(snapshot!.remainingPct).toBeCloseTo(8, 1);
      expect(snapshot!.providerId).toBe("anthropic");
      expect(snapshot!.modelId).toBe("claude");
    });

    it("parses x-ratelimit-remaining + reset for tokens dimension", () => {
      const futureMs = Date.now() + 60_000;
      const snapshot = parseRateLimitHeaders(
        {
          "x-ratelimit-remaining-tokens": "5000",
          "x-ratelimit-limit-tokens": "100000",
          "x-ratelimit-reset-tokens": String(futureMs),
        },
        "openai",
        "gpt-5",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.dimension).toBe("tokens");
      expect(snapshot!.remainingPct).toBeCloseTo(5, 1);
    });

    it("picks the more restrictive of (requests, tokens)", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snapshot = parseRateLimitHeaders(
        {
          "x-ratelimit-remaining-requests": "80",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-reset-requests": String(futureSec),
          "x-ratelimit-remaining-tokens": "5",
          "x-ratelimit-limit-tokens": "100",
          "x-ratelimit-reset-tokens": String(futureSec),
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.dimension).toBe("tokens");
      expect(snapshot!.remainingPct).toBeCloseTo(5, 1);
    });

    it("treats remaining as a percentage when no limit header is present", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snapshot = parseRateLimitHeaders(
        {
          "x-ratelimit-remaining-requests": "7",
          "x-ratelimit-reset-requests": String(futureSec),
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      // No limit header — 7 is interpreted as 7%.
      expect(snapshot!.remainingPct).toBe(7);
    });

    it("falls back to generic x-ratelimit-reset when per-dim reset is missing", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snapshot = parseRateLimitHeaders(
        {
          "x-ratelimit-remaining-requests": "5",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-reset": String(futureSec),
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.remainingPct).toBeCloseTo(5, 1);
    });

    it("returns null when remaining is unparseable", () => {
      expect(
        parseRateLimitHeaders(
          {
            "x-ratelimit-remaining-requests": "abc",
            "x-ratelimit-reset-requests": "10000000000",
          },
          "anthropic",
          "claude",
        ),
      ).toBeNull();
    });

    it("returns null when reset is unparseable", () => {
      expect(
        parseRateLimitHeaders(
          {
            "x-ratelimit-remaining-requests": "5",
            "x-ratelimit-reset-requests": "not a time",
          },
          "anthropic",
          "claude",
        ),
      ).toBeNull();
    });

    it("handles headers in mixed case", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snapshot = parseRateLimitHeaders(
        {
          "X-RateLimit-Remaining-Requests": "5",
          "X-RateLimit-Limit-Requests": "100",
          "X-RateLimit-Reset-Requests": String(futureSec),
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.remainingPct).toBeCloseTo(5, 1);
    });

    it("parses Anthropic-style headers for requests dimension", () => {
      // Anthropic returns reset as ISO 8601.
      const resetIso = new Date(Date.now() + 60_000).toISOString();
      const snapshot = parseRateLimitHeaders(
        {
          "anthropic-ratelimit-requests-remaining": "8",
          "anthropic-ratelimit-requests-limit": "100",
          "anthropic-ratelimit-requests-reset": resetIso,
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.dimension).toBe("requests");
      expect(snapshot!.remainingPct).toBeCloseTo(8, 1);
      expect(snapshot!.resetAtMs).toBe(new Date(resetIso).getTime());
    });

    it("parses Anthropic-style headers for tokens dimension", () => {
      const resetIso = new Date(Date.now() + 120_000).toISOString();
      const snapshot = parseRateLimitHeaders(
        {
          "anthropic-ratelimit-tokens-remaining": "5000",
          "anthropic-ratelimit-tokens-limit": "100000",
          "anthropic-ratelimit-tokens-reset": resetIso,
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.dimension).toBe("tokens");
      expect(snapshot!.remainingPct).toBeCloseTo(5, 1);
    });

    it("prefers OpenAI-style over Anthropic-style when both are present", () => {
      // Both header schemes may appear when an Anthropic-compatible
      // proxy is in front of an OpenAI-style backend. Prefer the
      // canonical OpenAI form when both are present.
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snapshot = parseRateLimitHeaders(
        {
          "x-ratelimit-remaining-requests": "50",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-reset-requests": String(futureSec),
          "anthropic-ratelimit-requests-remaining": "5",
          "anthropic-ratelimit-requests-limit": "100",
          "anthropic-ratelimit-requests-reset": new Date(Date.now() + 60_000).toISOString(),
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.remainingPct).toBeCloseTo(50, 1);
    });

    it("uses Anthropic-style remaining as a percentage when no limit header is present", () => {
      // Anthropic's documented format already gives remaining as 0-100.
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snapshot = parseRateLimitHeaders(
        {
          "anthropic-ratelimit-requests-remaining": "7",
          "anthropic-ratelimit-requests-reset": String(futureSec),
        },
        "anthropic",
        "claude",
      );
      expect(snapshot).not.toBeNull();
      expect(snapshot!.remainingPct).toBe(7);
    });
  });

  describe("recordProviderResponse + getLatestSnapshot", () => {
    it("stores the first snapshot seen", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      const snap = recordProviderResponse(
        {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "20",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-reset-requests": String(futureSec),
          },
        },
        "anthropic",
        "claude",
      );
      expect(snap).not.toBeNull();
      expect(getLatestSnapshot()).toEqual(snap);
    });

    it("keeps the more restrictive snapshot across responses", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;

      // First response: 50% remaining.
      recordProviderResponse(
        {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "50",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-reset-requests": String(futureSec),
          },
        },
        "anthropic",
        "claude",
      );
      const first = getLatestSnapshot();
      expect(first!.remainingPct).toBeCloseTo(50, 1);

      // Second response: 5% remaining — more restrictive.
      recordProviderResponse(
        {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "5",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-reset-requests": String(futureSec),
          },
        },
        "anthropic",
        "claude",
      );
      const second = getLatestSnapshot();
      expect(second!.remainingPct).toBeCloseTo(5, 1);

      // Third response: 30% remaining — less restrictive than the
      // 5% we already have. Should NOT overwrite.
      recordProviderResponse(
        {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "30",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-reset-requests": String(futureSec),
          },
        },
        "anthropic",
        "claude",
      );
      expect(getLatestSnapshot()!.remainingPct).toBeCloseTo(5, 1);
    });

    it("returns null and does not store when headers are absent", () => {
      const snap = recordProviderResponse(
        { status: 200, headers: {} },
        "anthropic",
        "claude",
      );
      expect(snap).toBeNull();
      expect(getLatestSnapshot()).toBeNull();
    });

    it("clearLatest resets state", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      recordProviderResponse(
        {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "5",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-reset-requests": String(futureSec),
          },
        },
        "anthropic",
        "claude",
      );
      expect(getLatestSnapshot()).not.toBeNull();
      clearLatest();
      expect(getLatestSnapshot()).toBeNull();
    });

    it("synthesises a snapshot from a 429 with no rate-limit headers (e.g. minimax)", () => {
      // This is the critical path for providers that don't expose
      // rate-limit data on 200 responses. The 429 itself is the signal.
      const snap = recordProviderResponse(
        {
          status: 429,
          headers: { "minimax-request-id": "abc-123" },
        },
        "minimax",
        "m3",
      );
      expect(snap).not.toBeNull();
      expect(snap!.dimension).toBe("retry-after");
      expect(snap!.remainingPct).toBe(0);
      expect(snap!.providerId).toBe("minimax");
      // Default 60s wait when retry-after is absent.
      const waitMs = snap!.resetAtMs - Date.now();
      expect(waitMs).toBeGreaterThanOrEqual(59_000);
      expect(waitMs).toBeLessThanOrEqual(61_000);
    });

    it("synthesises a snapshot from a 429 with retry-after header", () => {
      const snap = recordProviderResponse(
        {
          status: 429,
          headers: { "retry-after": "30" },
        },
        "minimax",
        "m3",
      );
      expect(snap).not.toBeNull();
      const waitMs = snap!.resetAtMs - Date.now();
      expect(waitMs).toBeGreaterThanOrEqual(29_000);
      expect(waitMs).toBeLessThanOrEqual(31_000);
    });

    it("bumps getThrottledCount on 429", () => {
      expect(getThrottledCount()).toBe(0);
      recordProviderResponse(
        { status: 429, headers: { "retry-after": "1" } },
        "minimax",
        "m3",
      );
      expect(getThrottledCount()).toBe(1);
      recordProviderResponse(
        { status: 429, headers: { "retry-after": "1" } },
        "minimax",
        "m3",
      );
      expect(getThrottledCount()).toBe(2);
    });

    it("does not bump getThrottledCount on 200", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      recordProviderResponse(
        {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "50",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-reset-requests": String(futureSec),
          },
        },
        "anthropic",
        "claude",
      );
      expect(getThrottledCount()).toBe(0);
    });

    it("sets the per-attempt throttled flag on 429", () => {
      expect(wasLastAttemptThrottled()).toBe(false);
      recordProviderResponse(
        { status: 429, headers: { "retry-after": "1" } },
        "minimax",
        "m3",
      );
      expect(wasLastAttemptThrottled()).toBe(true);
    });

    it("does not set the per-attempt throttled flag on 200", () => {
      const futureSec = Math.floor(Date.now() / 1000) + 60;
      recordProviderResponse(
        {
          status: 200,
          headers: {
            "x-ratelimit-remaining-requests": "50",
            "x-ratelimit-limit-requests": "100",
            "x-ratelimit-reset-requests": String(futureSec),
          },
        },
        "anthropic",
        "claude",
      );
      expect(wasLastAttemptThrottled()).toBe(false);
    });

    it("resetAttemptThrottledFlag clears the flag", () => {
      recordProviderResponse(
        { status: 429, headers: { "retry-after": "1" } },
        "minimax",
        "m3",
      );
      expect(wasLastAttemptThrottled()).toBe(true);
      resetAttemptThrottledFlag();
      expect(wasLastAttemptThrottled()).toBe(false);
    });
  });

  describe("pollMinimaxUsage", () => {
    const originalFetch = globalThis.fetch;

    function mockFetchResponse(status: number, body: unknown): void {
      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
    }

    afterEachRestoreFetch();

    function afterEachRestoreFetch() {
      afterEach(() => {
        globalThis.fetch = originalFetch;
      });
    }

    it("parses a successful response and returns a snapshot", async () => {
      mockFetchResponse(200, {
        model_remains: [
          {
            model_name: "general",
            current_interval_remaining_percent: 86,
            remains_time: 1136897,
            current_weekly_remaining_percent: 84,
            weekly_remains_time: 501536897,
          },
        ],
        base_resp: { status_code: 0, status_msg: "success" },
      });
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).not.toBeNull();
      expect(snap!.remainingPct).toBe(86);
      expect(snap!.providerId).toBe("minimax");
      expect(snap!.modelId).toBe("general");
      // The reset time should be roughly `remains_time` seconds in the future.
      const waitMs = snap!.resetAtMs - Date.now();
      expect(waitMs).toBeGreaterThanOrEqual(1_136_897_000 - 1000);
      expect(waitMs).toBeLessThanOrEqual(1_136_897_000 + 1000);
    });

    it("prefers the 'general' model entry over other categories", async () => {
      mockFetchResponse(200, {
        model_remains: [
          { model_name: "video", current_interval_remaining_percent: 100, remains_time: 100 },
          { model_name: "general", current_interval_remaining_percent: 50, remains_time: 200 },
        ],
      });
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).not.toBeNull();
      expect(snap!.remainingPct).toBe(50);
      expect(snap!.modelId).toBe("general");
    });

    it("falls back to the first entry when 'general' is missing", async () => {
      mockFetchResponse(200, {
        model_remains: [
          { model_name: "video", current_interval_remaining_percent: 75, remains_time: 100 },
        ],
      });
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).not.toBeNull();
      expect(snap!.remainingPct).toBe(75);
      expect(snap!.modelId).toBe("video");
    });

    it("returns null on HTTP error", async () => {
      mockFetchResponse(500, { error: "internal" });
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).toBeNull();
    });

    it("returns null on malformed JSON", async () => {
      globalThis.fetch = (async () => {
        return new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch;
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).toBeNull();
    });

    it("returns null when model_remains is missing", async () => {
      mockFetchResponse(200, { base_resp: { status_code: 0 } });
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).toBeNull();
    });

    it("returns null when model_remains is empty", async () => {
      mockFetchResponse(200, { model_remains: [] });
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).toBeNull();
    });

    it("returns null when remaining percent is missing or invalid", async () => {
      mockFetchResponse(200, {
        model_remains: [
          { model_name: "general", remains_time: 100 },
        ],
      });
      expect(await pollMinimaxUsage("test-key")).toBeNull();
    });

    it("returns null when remains_time is negative", async () => {
      mockFetchResponse(200, {
        model_remains: [
          {
            model_name: "general",
            current_interval_remaining_percent: 50,
            remains_time: -10,
          },
        ],
      });
      expect(await pollMinimaxUsage("test-key")).toBeNull();
    });

    it("returns null on network error (fetch throws)", async () => {
      globalThis.fetch = (async () => {
        throw new Error("ECONNREFUSED");
      }) as typeof fetch;
      const snap = await pollMinimaxUsage("test-key");
      expect(snap).toBeNull();
    });

    it("honors AbortSignal", async () => {
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        // Replicate native fetch: if the signal is already aborted,
        // reject immediately. Otherwise wait for the abort event.
        if (init?.signal?.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        });
      }) as typeof fetch;
      const controller = new AbortController();
      controller.abort();
      const snap = await pollMinimaxUsage("test-key", controller.signal);
      expect(snap).toBeNull();
    });
  });

  describe("pollProviderUsage", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("returns null when no model is set", async () => {
      const snap = await pollProviderUsage({
        model: undefined,
        modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "x" }) },
        signal: undefined,
      });
      expect(snap).toBeNull();
    });

    it("returns null for non-minimax providers", async () => {
      const snap = await pollProviderUsage({
        model: { provider: "anthropic", id: "claude" },
        modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "x" }) },
        signal: undefined,
      });
      expect(snap).toBeNull();
    });

    it("returns null when modelRegistry.getApiKeyAndHeaders fails", async () => {
      const snap = await pollProviderUsage({
        model: { provider: "minimax", id: "m3" },
        modelRegistry: {
          getApiKeyAndHeaders: async () => {
            throw new Error("auth lookup failed");
          },
        },
        signal: undefined,
      });
      expect(snap).toBeNull();
    });

    it("returns null when auth.ok is false", async () => {
      const snap = await pollProviderUsage({
        model: { provider: "minimax", id: "m3" },
        modelRegistry: {
          getApiKeyAndHeaders: async () => ({ ok: false, error: "no key" }),
        },
        signal: undefined,
      });
      expect(snap).toBeNull();
    });

    it("returns null when apiKey is missing", async () => {
      const snap = await pollProviderUsage({
        model: { provider: "minimax", id: "m3" },
        modelRegistry: {
          getApiKeyAndHeaders: async () => ({ ok: true }),
        },
        signal: undefined,
      });
      expect(snap).toBeNull();
    });

    it("fetches and stores the snapshot for minimax", async () => {
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            model_remains: [
              {
                model_name: "general",
                current_interval_remaining_percent: 7,
                remains_time: 3600,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }) as typeof fetch;

      clearLatest();
      const snap = await pollProviderUsage({
        model: { provider: "minimax", id: "m3" },
        modelRegistry: {
          getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }),
        },
        signal: undefined,
      });
      expect(snap).not.toBeNull();
      expect(snap!.remainingPct).toBe(7);
      // The snapshot is also stored as latest.
      expect(getLatestSnapshot()).toEqual(snap);
    });
  });

  describe("configureRateLimit + getRateLimitConfig", () => {
    it("uses DEFAULT_CONFIG initially", () => {
      expect(getRateLimitConfig().thresholdPct).toBe(DEFAULT_CONFIG.thresholdPct);
      expect(getRateLimitConfig().postResetBufferMs).toBe(DEFAULT_CONFIG.postResetBufferMs);
    });

    it("applies partial updates", () => {
      configureRateLimit({ thresholdPct: 25 });
      expect(getRateLimitConfig().thresholdPct).toBe(25);
    });

    it("rejects non-finite values", () => {
      configureRateLimit({ thresholdPct: NaN });
      expect(getRateLimitConfig().thresholdPct).toBe(DEFAULT_CONFIG.thresholdPct);
    });

    it("accepts postResetBufferMs of 0 (disable buffer)", () => {
      configureRateLimit({ postResetBufferMs: 0 });
      expect(getRateLimitConfig().postResetBufferMs).toBe(0);
    });

    it("rejects negative postResetBufferMs", () => {
      configureRateLimit({ postResetBufferMs: -1000 });
      expect(getRateLimitConfig().postResetBufferMs).toBe(DEFAULT_CONFIG.postResetBufferMs);
    });
  });

  describe("gateIfNeeded", () => {
    function makeSnapshot(overrides: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
      return {
        remainingPct: 5,
        dimension: "requests",
        resetAtMs: Date.now() + 60_000,
        providerId: "anthropic",
        modelId: "claude",
        ...overrides,
      };
    }

    /**
     * Drive the snapshot into the module's internal state via the
     * public `recordProviderResponse` API, using a synthetic event
     * that exactly produces the desired remaining percentage.
     */
    function recordSnapshot(snap: RateLimitSnapshot): void {
      clearLatest();
      const futureSec = Math.floor(snap.resetAtMs / 1000);
      const headers: Record<string, string> = {
        "x-ratelimit-remaining-requests": String(snap.remainingPct),
        "x-ratelimit-limit-requests": "100",
        "x-ratelimit-reset-requests": String(futureSec),
      };
      recordProviderResponse(
        { status: 200, headers },
        snap.providerId,
        snap.modelId,
      );
    }

    it("is a no-op when no snapshot is recorded", async () => {
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.pollIterations).toBe(0);
      expect(result.aborted).toBe(false);
      expect(ctx.calls).toEqual([]);
    });

    it("is a no-op when remaining is above the threshold", async () => {
      recordSnapshot(makeSnapshot({ remainingPct: 50 }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(false);
      expect(result.reason).toBeNull();
      expect(result.pollIterations).toBe(0);
      expect(ctx.calls).toEqual([]);
    });

    it("is a no-op when the reset time has already passed", async () => {
      // Disable the buffer so a 1s-ago reset triggers an immediate no-op.
      configureRateLimit({ postResetBufferMs: 0 });
      recordSnapshot(makeSnapshot({ resetAtMs: Date.now() - 1000 }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(false);
      expect(result.pollIterations).toBe(0);
    });

    it("sleeps until reset+buffer when below threshold", async () => {
      // Use a 2-second future reset aligned to the epoch boundary so
      // the per-second truncation in parseResetHeader round-trips.
      // Disable the post-reset buffer for this test so the total wait
      // is just the gap to the reset (plus the default 1-min buffer
      // wouldn't make sense for a 2s wait).
      configureRateLimit({ postResetBufferMs: 0 });
      const resetAtMs = (Math.floor(Date.now() / 1000) + 2) * 1000;
      recordSnapshot(makeSnapshot({ remainingPct: 3, resetAtMs }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(true);
      expect(result.reason).toContain("anthropic/claude");
      // Status should have been set (to text) and then cleared (to undefined).
      const setStatusCalls = ctx.calls.filter((c) => c.method === "setStatus");
      expect(setStatusCalls.length).toBeGreaterThanOrEqual(2);
      const lastCall = setStatusCalls[setStatusCalls.length - 1];
      expect(lastCall?.args[1]).toBeUndefined();
      expect(result.pollIterations).toBeGreaterThanOrEqual(1);
    });

    it("waits for the configured post-reset buffer before returning", async () => {
      // Set a 500ms buffer. Reset is 200ms in the future. Total
      // wait should be ~700ms (200ms until reset + 500ms buffer).
      configureRateLimit({ postResetBufferMs: 500 });
      const resetAtMs = (Math.floor(Date.now() / 1000) + 2) * 1000;
      recordSnapshot(makeSnapshot({ remainingPct: 3, resetAtMs }));
      const ctx = makeFakeUi();
      const start = Date.now();
      const result = await gateIfNeeded(ctx);
      const elapsed = Date.now() - start;
      // Reset was ~2s in the future, plus 500ms buffer = ~2.5s total.
      // Allow generous bounds for CI timing.
      expect(elapsed).toBeGreaterThanOrEqual(2_000);
      expect(elapsed).toBeLessThan(2_700);
      expect(result.slept).toBe(true);
    });

    it("honors the threshold from config", async () => {
      configureRateLimit({ thresholdPct: 20, postResetBufferMs: 0 });
      const resetAtMs = (Math.floor(Date.now() / 1000) + 2) * 1000;
      // 15% remaining is below 20% threshold — should sleep.
      recordSnapshot(makeSnapshot({ remainingPct: 15, resetAtMs }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(true);
    });

    it("does not sleep when threshold is 0 (disabled)", async () => {
      configureRateLimit({ thresholdPct: 0, postResetBufferMs: 0 });
      const resetAtMs = (Math.floor(Date.now() / 1000) + 2) * 1000;
      recordSnapshot(makeSnapshot({ remainingPct: 5, resetAtMs }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(false);
    });

    it("is a no-op when the reset+buffer is already past", async () => {
      // Reset was 10s ago, buffer is 1s. Total target was 9s ago.
      configureRateLimit({ postResetBufferMs: 1000 });
      recordSnapshot(makeSnapshot({ resetAtMs: Date.now() - 10_000 }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(false);
    });

    it("includes the buffer in the notify message when buffer > 0", async () => {
      configureRateLimit({ postResetBufferMs: 60_000 });
      const resetAtMs = (Math.floor(Date.now() / 1000) + 5) * 1000;
      recordSnapshot(makeSnapshot({ remainingPct: 3, resetAtMs }));
      // Drive a 429 so the notify fires (we always notify on 429).
      recordProviderResponse(
        { status: 429, headers: { "retry-after": "1" } },
        "anthropic",
        "claude",
      );
      const ctx = makeFakeUi();
      // Don't await — we just want to capture the notify then abort.
      const controller = new AbortController();
      const promise = gateIfNeeded(ctx, controller.signal);
      setTimeout(() => controller.abort(), 50);
      await promise;
      const notify = ctx.calls.find((c) => c.method === "notify");
      expect(notify).toBeDefined();
      expect(String(notify!.args[0])).toMatch(/buffer/i);
    });

    it("aborts the sleep when the signal fires", async () => {
      configureRateLimit({ postResetBufferMs: 0 });
      recordSnapshot(makeSnapshot({ remainingPct: 1, resetAtMs: Date.now() + 5_000 }));
      const ctx = makeFakeUi();
      const controller = new AbortController();
      const promise = gateIfNeeded(ctx, controller.signal);
      // Abort after a short delay.
      setTimeout(() => controller.abort(), 30);
      const start = Date.now();
      const result = await promise;
      const elapsed = Date.now() - start;
      // The full wait is 5s; abort should resolve in < 500ms.
      expect(elapsed).toBeLessThan(500);
      expect(result.aborted).toBe(true);
      // Status should still have been cleared.
      const lastSet = ctx.calls.filter((c) => c.method === "setStatus").pop();
      expect(lastSet?.args[1]).toBeUndefined();
    });

    it("respects an already-aborted signal", async () => {
      configureRateLimit({ postResetBufferMs: 0 });
      recordSnapshot(makeSnapshot({ remainingPct: 1, resetAtMs: Date.now() + 60_000 }));
      const ctx = makeFakeUi();
      const controller = new AbortController();
      controller.abort();
      const start = Date.now();
      const result = await gateIfNeeded(ctx, controller.signal);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(50);
      expect(result.aborted).toBe(true);
    });

    it("polls in chunks when wait is longer than pollIntervalMs", async () => {
      // Wait 2s total, poll every 200ms. With ~200-400ms of test
      // setup overhead before the wait starts, we expect 6-10 iterations.
      // (Test-time variance: macOS schedulers can delay the final sleep.)
      configureRateLimit({ pollIntervalMs: 200, postResetBufferMs: 0 });
      const resetAtMs = (Math.floor(Date.now() / 1000) + 2) * 1000;
      recordSnapshot(makeSnapshot({
        remainingPct: 1,
        resetAtMs,
      }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(true);
      expect(result.aborted).toBe(false);
      expect(result.pollIterations).toBeGreaterThanOrEqual(6);
      expect(result.pollIterations).toBeLessThanOrEqual(12);
      // The footer status should have been set on every iteration.
      const setStatusCalls = ctx.calls.filter(
        (c) => c.method === "setStatus" && c.args[1] !== undefined,
      );
      expect(setStatusCalls.length).toBe(result.pollIterations);
    });

    it("aborts mid-poll when the signal fires between iterations", async () => {
      // Long wait (5s), short poll interval (50ms). Abort after 100ms
      // — should resolve quickly and report aborted=true.
      configureRateLimit({ pollIntervalMs: 50, postResetBufferMs: 0 });
      const resetAtMs = (Math.floor(Date.now() / 1000) + 5) * 1000;
      recordSnapshot(makeSnapshot({
        remainingPct: 1,
        resetAtMs,
      }));
      const ctx = makeFakeUi();
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);
      const start = Date.now();
      const result = await gateIfNeeded(ctx, controller.signal);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
      expect(result.aborted).toBe(true);
      expect(result.slept).toBe(false);
      expect(result.pollIterations).toBeGreaterThanOrEqual(1);
      // Final status should be cleared even on abort.
      const lastSet = ctx.calls.filter((c) => c.method === "setStatus").pop();
      expect(lastSet?.args[1]).toBeUndefined();
    });

    it("notifies on 429 (throttledCount > 0) regardless of notifyOnPredictive", async () => {
      // Simulate a prior 429 by bumping the counter directly via
      // recordProviderResponse with status 429.
      recordProviderResponse(
        { status: 429, headers: { "retry-after": "2" } },
        "minimax",
        "m3",
      );
      expect(getThrottledCount()).toBe(1);
      // 429s always notify even when notifyOnPredictive is false (default).
      configureRateLimit({ pollIntervalMs: 1000, postResetBufferMs: 0 });
      recordSnapshot(makeSnapshot({
        remainingPct: 0,
        resetAtMs: (Math.floor(Date.now() / 1000) + 1) * 1000,
      }));
      const ctx = makeFakeUi();
      const result = await gateIfNeeded(ctx);
      expect(result.slept).toBe(true);
      const notifies = ctx.calls.filter((c) => c.method === "notify");
      expect(notifies.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("sleep", () => {
    it("resolves after the given ms", async () => {
      const start = Date.now();
      await sleep(50);
      expect(Date.now() - start).toBeGreaterThanOrEqual(45);
    });

    it("resolves immediately when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const start = Date.now();
      await sleep(10_000, controller.signal);
      expect(Date.now() - start).toBeLessThan(50);
    });

    it("resolves early when signal aborts mid-sleep", async () => {
      const controller = new AbortController();
      const promise = sleep(10_000, controller.signal);
      setTimeout(() => controller.abort(), 20);
      const start = Date.now();
      await promise;
      expect(Date.now() - start).toBeLessThan(500);
    });
  });

  describe("formatDuration", () => {
    it("formats sub-minute durations as seconds", () => {
      expect(formatDuration(0)).toBe("0s");
      expect(formatDuration(45_000)).toBe("45s");
    });

    it("formats sub-hour durations as minutes (+ optional seconds)", () => {
      expect(formatDuration(60_000)).toBe("1m");
      expect(formatDuration(90_000)).toBe("1m30s");
      expect(formatDuration(30 * 60_000)).toBe("30m");
    });

    it("formats hour-scale durations as hours (+ optional minutes)", () => {
      expect(formatDuration(60 * 60_000)).toBe("1h");
      expect(formatDuration(90 * 60_000)).toBe("1h30m");
      expect(formatDuration(5 * 60 * 60_000)).toBe("5h");
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

interface FakeUiCall {
  method: "notify" | "setStatus";
  args: unknown[];
}

function makeFakeUi(): {
  ui: {
    notify: (m: string, l: "info" | "warning" | "error") => void;
    setStatus: (k: string, t: string | undefined) => void;
  };
  calls: FakeUiCall[];
} {
  const calls: FakeUiCall[] = [];
  return {
    calls,
    ui: {
      notify: (message: string, level: "info" | "warning" | "error") => {
        calls.push({ method: "notify", args: [message, level] });
      },
      setStatus: (key: string, text: string | undefined) => {
        calls.push({ method: "setStatus", args: [key, text] });
      },
    },
  };
}

void vi;
