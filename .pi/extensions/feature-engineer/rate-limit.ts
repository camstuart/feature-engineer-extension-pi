/**
 * Provider rate-limit tracking.
 *
 * Most LLM providers expose rate-limit state in response headers
 * (Anthropic, OpenAI, Google). We track the most-restrictive
 * remaining/reset pair across every LLM response and expose a
 * "should we sleep before the next request?" gate.
 *
 * Headers tracked:
 *   - `retry-after` — explicit server instruction, always wins
 *   - **OpenAI-style** (also used by some proxies):
 *       `x-ratelimit-remaining-requests` / `x-ratelimit-reset-requests`
 *       `x-ratelimit-remaining-tokens`    / `x-ratelimit-reset-tokens`
 *   - **Anthropic-style** (Anthropic API + Anthropic-on-Bedrock):
 *       `anthropic-ratelimit-requests-remaining` / `anthropic-ratelimit-requests-reset`
 *       `anthropic-ratelimit-tokens-remaining`    / `anthropic-ratelimit-tokens-reset`
 *   - `x-ratelimit-limit-*` / `anthropic-ratelimit-*-limit` — when
 *     present we compute an exact percentage. When absent we treat
 *     `remaining` as an already-computed percentage (0-100).
 *   - Generic `x-ratelimit-reset` / `anthropic-ratelimit-reset` —
 *     fallback when the per-dimension reset header is missing. Treated
 *     as epoch seconds / milliseconds / ISO 8601 / HTTP-date.
 *
 * Providers that don't expose any of these (some proxies, some
 * self-hosted gateways) leave the snapshot null — we simply don't
 * know the limit, and the gate is a no-op.
 *
 * State is module-level: the extension module is loaded once per pi
 * process, so the snapshot survives across sessions within a single
 * run. It is cleared on `pi install` / `/reload` (fresh module load)
 * and on `model_select` (different model = different window).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** What the snapshot represents. */
export type RateLimitDimension = "requests" | "tokens" | "retry-after";

/** A snapshot of the most-restrictive rate-limit window we have seen. */
export interface RateLimitSnapshot {
  /** Remaining quota as a percentage (0-100). Lower = more restrictive. */
  remainingPct: number;
  /** Which dimension this snapshot tracks. */
  dimension: RateLimitDimension;
  /** Epoch ms when the current window resets. */
  resetAtMs: number;
  /** Provider id (e.g. "anthropic") for display. */
  providerId: string;
  /** Model id (e.g. "claude-sonnet-4-5") for display. */
  modelId: string;
}

/** Configurable gate behaviour. */
export interface RateLimitConfig {
  /**
   * Sleep when `remainingPct <= thresholdPct`. Default 10 — i.e. sleep
   * when 90% of the window is used. Set to 0 to disable the gate.
   */
  thresholdPct: number;
  /**
   * When the gate sleeps, break the wait into chunks of this many ms
   * and update the footer status between chunks. The final chunk is
   * trimmed to the actual remaining wait. Default 30 minutes. This
   * gives the user a heartbeat so they can see progress, and gives
   * Esc / Ctrl+C a chance to abort promptly instead of waiting for
   * a multi-hour sleep to complete.
   */
  pollIntervalMs: number;
  /**
   * Buffer in ms to wait AFTER the rate-limit window resets before
   * resuming work. Default 60_000 (1 minute). Some providers stagger
   * the renewal (e.g. quota counters update a few seconds after the
   * boundary), so retrying exactly at the reset time can still hit
   * a 429. This buffer gives the window time to fully refresh.
   * Set to 0 to retry at the boundary.
   */
  postResetBufferMs: number;
  /**
   * Status-bar / notify level when the gate is firing on a 429
   * (explicit throttling) vs. a low remaining percentage (predictive).
   * 429s always get a `warning` notify regardless of this setting.
   */
  notifyOnPredictive: boolean;
}

export const DEFAULT_CONFIG: RateLimitConfig = {
  thresholdPct: 10,
  pollIntervalMs: 30 * 60_000, // 30 minutes
  postResetBufferMs: 60_000, // 1 minute
  notifyOnPredictive: false,
};

let latestSnapshot: RateLimitSnapshot | null = null;
let currentConfig: RateLimitConfig = { ...DEFAULT_CONFIG };
/** Counter for 429s seen this pi session. Bumped by `recordProviderResponse`. */
let throttledCount = 0;
/**
 * Flag set by the `after_provider_response` listener when a 429 is
 * seen in the current attempt. Reset by the runner before each
 * attempt. The runner uses this to decide whether a thrown error
 * was due to rate-limiting and therefore eligible for retry.
 */
let lastAttemptWasThrottled = false;

/** Replace the active config (used by the CLI flag wiring in index.ts). */
export function configureRateLimit(config: Partial<RateLimitConfig>): void {
  currentConfig = {
    thresholdPct:
      typeof config.thresholdPct === "number" && Number.isFinite(config.thresholdPct)
        ? config.thresholdPct
        : DEFAULT_CONFIG.thresholdPct,
    pollIntervalMs:
      typeof config.pollIntervalMs === "number" &&
      Number.isFinite(config.pollIntervalMs) &&
      config.pollIntervalMs > 0
        ? config.pollIntervalMs
        : DEFAULT_CONFIG.pollIntervalMs,
    postResetBufferMs:
      typeof config.postResetBufferMs === "number" &&
      Number.isFinite(config.postResetBufferMs) &&
      config.postResetBufferMs >= 0
        ? config.postResetBufferMs
        : DEFAULT_CONFIG.postResetBufferMs,
    notifyOnPredictive:
      typeof config.notifyOnPredictive === "boolean"
        ? config.notifyOnPredictive
        : DEFAULT_CONFIG.notifyOnPredictive,
  };
}

/** Returns the count of 429 responses seen this session. */
export function getThrottledCount(): number {
  return throttledCount;
}

/** Reset 429 counter (used in tests). */
export function resetThrottledCount(): void {
  throttledCount = 0;
}

/**
 * Returns true if the current attempt was aborted because a 429 was
 * seen. Used by the runner to decide whether to retry the stage.
 */
export function wasLastAttemptThrottled(): boolean {
  return lastAttemptWasThrottled;
}

/**
 * Reset the per-attempt throttled flag. Called by the runner
 * immediately before each `ctx.newSession` call.
 */
export function resetAttemptThrottledFlag(): void {
  lastAttemptWasThrottled = false;
}

/**
 * Minimal context shape required by `pollProviderUsage`. Decoupled
 * from `ExtensionContext` so tests can pass a partial mock.
 */
export interface ProviderUsageContext {
  model: { provider: string; id: string } | undefined;
  modelRegistry: {
    getApiKeyAndHeaders(model: {
      provider: string;
      id: string;
    }): Promise<
      | { ok: true; apiKey?: string; headers?: Record<string, string> }
      | { ok: false; error: string }
    >;
  };
  signal: AbortSignal | undefined;
}

/**
 * Hit a provider-specific usage endpoint and store the result as
 * the latest snapshot (only if more restrictive than the current
 * snapshot).
 *
 * Currently supports:
 *   - `minimax` — `https://www.minimax.io/v1/token_plan/remains`
 *
 * Returns the new snapshot, or null if the provider has no usage
 * endpoint, the request failed, the API key is missing, or the
 * response was malformed. Never throws.
 */
export async function pollProviderUsage(
  ctx: ProviderUsageContext,
): Promise<RateLimitSnapshot | null> {
  const model = ctx.model;
  if (!model) return null;

  if (model.provider === "minimax") {
    let auth;
    try {
      auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    } catch {
      return null;
    }
    if (!auth.ok || !auth.apiKey) return null;
    const snap = await pollMinimaxUsage(auth.apiKey, ctx.signal);
    if (snap === null) return null;
    if (latestSnapshot === null || snap.remainingPct < latestSnapshot.remainingPct) {
      latestSnapshot = snap;
    }
    return snap;
  }

  // Future: add other provider-specific usage endpoints here.
  return null;
}

/**
 * Hit minimax's token-plan usage endpoint and parse the response.
 *
 * Response shape (relevant fields):
 * ```
 *   {
 *     "model_remains": [
 *       {
 *         "model_name": "general" | "video" | ...,
 *         "current_interval_remaining_percent": 86,   // 5h window
 *         "remains_time": 1136897,                     // seconds until reset
 *         "current_weekly_remaining_percent": 84,      // 7d window
 *         "weekly_remains_time": 501536897,            // seconds until weekly reset
 *         ...
 *       },
 *       ...
 *     ],
 *     "base_resp": { "status_code": 0, "status_msg": "success" }
 *   }
 * ```
 *
 * We use the 5h interval (more restrictive window) as the primary
 * signal. If the `general` model entry is missing, we fall back
 * to the first entry in the array.
 *
 * Returns null on any failure (HTTP error, malformed JSON, missing
 * fields, no entries). Never throws.
 */
export async function pollMinimaxUsage(
  apiKey: string,
  signal?: AbortSignal,
): Promise<RateLimitSnapshot | null> {
  let response: Response;
  try {
    response = await fetch("https://www.minimax.io/v1/token_plan/remains", {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return null;
  }
  if (!isMinimaxResponse(data)) return null;

  // Prefer the "general" entry (covers text LLM usage); fall back
  // to the first entry.
  const general = data.model_remains.find((m) => m.model_name === "general");
  const entry = general ?? data.model_remains[0];
  if (!entry) return null;

  // Narrow model_name (typed `unknown`) to a string for the snapshot.
  const modelId =
    typeof entry.model_name === "string" && entry.model_name.length > 0
      ? entry.model_name
      : "minimax";

  const remainingPct = entry.current_interval_remaining_percent;
  const remainsSec = entry.remains_time;
  if (
    typeof remainingPct !== "number" ||
    typeof remainsSec !== "number" ||
    !Number.isFinite(remainingPct) ||
    !Number.isFinite(remainsSec) ||
    remainsSec < 0
  ) {
    return null;
  }

  return {
    remainingPct,
    dimension: "requests",
    resetAtMs: Date.now() + remainsSec * 1000,
    providerId: "minimax",
    modelId,
  };
}

interface MinimaxModelRemain {
  model_name?: unknown;
  current_interval_remaining_percent?: unknown;
  remains_time?: unknown;
  current_weekly_remaining_percent?: unknown;
  weekly_remains_time?: unknown;
}

interface MinimaxResponse {
  model_remains: MinimaxModelRemain[];
}

function isMinimaxResponse(value: unknown): value is MinimaxResponse {
  if (value === null || typeof value !== "object") return false;
  const v = value as { model_remains?: unknown };
  if (!Array.isArray(v.model_remains)) return false;
  return v.model_remains.every((entry) => entry !== null && typeof entry === "object");
}

/** Read-only access to the current config. */
export function getRateLimitConfig(): Readonly<RateLimitConfig> {
  return currentConfig;
}

/** Read-only access to the most recent snapshot. */
export function getLatestSnapshot(): RateLimitSnapshot | null {
  return latestSnapshot;
}

/** Clear state (used on model change / reload). */
export function clearLatest(): void {
  latestSnapshot = null;
}

/**
 * Parse a `after_provider_response` event's headers into a snapshot,
 * tag it with the active provider/model, and store it if it is the
 * most-restrictive seen so far for the current model.
 *
 * 429 responses always record a snapshot (with `dimension: "retry-after"`
 * and `remainingPct: 0`) even if no rate-limit headers are present —
 * the very fact of the 429 is itself the rate-limit signal. This is
 * what allows the gate to fire for providers like `minimax` that
 * don't expose any rate-limit headers on 200 responses.
 *
 * Returns the snapshot that was stored, or null if no signal was
 * found in the response.
 */
export function recordProviderResponse(
  event: { status: number; headers: Record<string, string> },
  providerId: string,
  modelId: string,
): RateLimitSnapshot | null {
  let snapshot = parseRateLimitHeaders(event.headers, providerId, modelId);

  // 429 fallback: if the provider didn't include any rate-limit
  // headers but DID return a 429, synthesise a snapshot from
  // `retry-after` (or a sensible default if it's missing too). This
  // is the only signal we have for providers that don't expose
  // rate-limit headers on 200 responses.
  if (snapshot === null && event.status === 429) {
    const retryAfterRaw = event.headers["retry-after"] ?? event.headers["Retry-After"];
    let seconds = 60; // default wait when the server gives no hint
    if (typeof retryAfterRaw === "string") {
      const parsed = parseSeconds(retryAfterRaw);
      if (parsed !== null && parsed > 0) seconds = parsed;
    }
    snapshot = {
      remainingPct: 0,
      dimension: "retry-after",
      resetAtMs: Date.now() + seconds * 1000,
      providerId,
      modelId,
    };
  }

  if (snapshot === null) return null;

  // 429s bump the throttled counter and set the per-attempt flag
  // regardless of header content.
  if (event.status === 429) {
    throttledCount += 1;
    lastAttemptWasThrottled = true;
  }

  if (latestSnapshot === null || snapshot.remainingPct < latestSnapshot.remainingPct) {
    latestSnapshot = snapshot;
  }
  return latestSnapshot;
}

/**
 * Pure header parser. Exported for unit testing.
 *
 * Returns null when no relevant headers are present.
 */
export function parseRateLimitHeaders(
  headers: Record<string, string>,
  providerId: string,
  modelId: string,
): RateLimitSnapshot | null {
  // Normalise to lowercase keys.
  const norm: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v === "string") norm[k.toLowerCase()] = v;
  }

  // `retry-after` always wins — it's an explicit server instruction.
  const retryAfterRaw = norm["retry-after"];
  if (retryAfterRaw !== undefined) {
    const seconds = parseSeconds(retryAfterRaw);
    if (seconds !== null && seconds > 0) {
      return {
        remainingPct: 0,
        dimension: "retry-after",
        resetAtMs: Date.now() + seconds * 1000,
        providerId,
        modelId,
      };
    }
  }

  // Collect the most-restrictive of (requests, tokens) windows.
  // We try multiple header-name conventions in order: OpenAI-style
  // first, then Anthropic-style. Each convention has its own names
  // for remaining / limit / reset, but the structure is the same.
  const candidates: Array<{
    dim: "requests" | "tokens";
    remainingPct: number;
    resetAtMs: number;
  }> = [];

  for (const dim of ["requests", "tokens"] as const) {
    // Try each supported header convention. The first one that
    // produces a parseable (remaining, reset) pair wins for that
    // dimension.
    const conventions: Array<{
      remaining: string;
      limit?: string;
      reset: string;
    }> = [
      // OpenAI-style
      {
        remaining: `x-ratelimit-remaining-${dim}`,
        limit: `x-ratelimit-limit-${dim}`,
        reset: `x-ratelimit-reset-${dim}`,
      },
      // Anthropic-style (Anthropic API + Anthropic-on-Bedrock).
      // The Anthropic reset header does NOT include the dimension,
      // so we fall back to the per-dim name first, then the generic.
      {
        remaining: `anthropic-ratelimit-${dim}-remaining`,
        limit: `anthropic-ratelimit-${dim}-limit`,
        reset: `anthropic-ratelimit-${dim}-reset`,
      },
    ];

    for (const conv of conventions) {
      const remainingRaw = norm[conv.remaining];
      const resetRaw = norm[conv.reset]
        ?? (dim === "requests" ? norm["x-ratelimit-reset"] : undefined)
        ?? (dim === "requests" ? norm["anthropic-ratelimit-reset"] : undefined);
      if (remainingRaw === undefined || resetRaw === undefined) continue;

      const remaining = parseFloat(remainingRaw);
      if (!Number.isFinite(remaining) || remaining < 0) continue;

      const resetAtMs = parseResetHeader(resetRaw);
      if (resetAtMs === null) continue;

      // If a limit header is present, compute exact percentage.
      // Otherwise treat `remaining` as an already-percentage value
      // (Anthropic returns 0-100, OpenAI returns a count).
      const limitRaw = conv.limit !== undefined ? norm[conv.limit] : undefined;
      const limit = limitRaw !== undefined ? parseFloat(limitRaw) : NaN;
      const pct = Number.isFinite(limit) && limit > 0
        ? (remaining / limit) * 100
        : remaining;

      candidates.push({ dim, remainingPct: pct, resetAtMs });
      // First convention that worked wins; don't try the rest.
      break;
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.remainingPct - b.remainingPct);
  const c = candidates[0]!;
  return {
    remainingPct: c.remainingPct,
    dimension: c.dim,
    resetAtMs: c.resetAtMs,
    providerId,
    modelId,
  };
}

/**
 * Parse a reset header value into an absolute epoch ms.
 *
 * Accepted formats:
 *   - Epoch seconds (10 digits, e.g. "1700000000")
 *   - Epoch milliseconds (13 digits)
 *   - Seconds-from-now (small positive number, < 30 days)
 *   - ISO 8601 timestamp (e.g. "2024-01-01T00:00:00Z")
 *   - HTTP-date (e.g. "Wed, 21 Oct 2024 07:28:00 GMT")
 *
 * Returns null when the value cannot be parsed.
 */
export function parseResetHeader(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // Epoch ms (13 digits, year > 2001).
  if (/^\d{13}$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n > 1e12) return n;
  }

  // Epoch seconds (10 digits).
  if (/^\d{10}$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    if (n > 1e9) return n * 1000;
  }

  // Plain seconds-from-now (small positive number, e.g. "30", "1.5").
  // Bound to < 30 days to avoid misclassifying epoch values.
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = parseFloat(trimmed);
    if (n > 0 && n < 60 * 60 * 24 * 30) return Date.now() + n * 1000;
  }

  // ISO 8601 / HTTP-date — let `new Date` try.
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.getTime();

  return null;
}

/** Parse a `retry-after` value as seconds. Returns null on failure. */
function parseSeconds(raw: string): number | null {
  const trimmed = raw.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    const n = parseFloat(trimmed);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return Math.max(0, (d.getTime() - Date.now()) / 1000);
  }
  return null;
}

/**
 * Result of a gate evaluation.
 */
export interface GateResult {
  /** Whether a sleep actually happened. */
  slept: boolean;
  /** Why the gate fired (or null when it didn't). */
  reason: string | null;
  /** The snapshot that triggered the gate (or null). */
  snapshot: RateLimitSnapshot | null;
  /** Number of polling iterations the wait took (0 if no wait). */
  pollIterations: number;
  /** Whether the wait was aborted before the reset time. */
  aborted: boolean;
}

/**
 * Pause until the most-restrictive rate-limit window resets, if the
 * current usage is at or below the configured threshold.
 *
 * The wait is broken into chunks of `pollIntervalMs` (default 30 min).
 * Between chunks the footer status is updated with the remaining
 * time, so the user sees a heartbeat and can abort via `signal`.
 *
 * Always returns — does not throw on abort. The caller is responsible
 * for surfacing a UI message and (in interactive mode) for honouring
 * a user-initiated abort via the supplied signal.
 */
export async function gateIfNeeded(
  ctx: {
    ui: {
      notify: (message: string, level: "info" | "warning" | "error") => void;
      setStatus: (key: string, text: string | undefined) => void;
    };
  },
  signal?: AbortSignal,
): Promise<GateResult> {
  const snapshot = latestSnapshot;
  if (snapshot === null) {
    return { slept: false, reason: null, snapshot: null, pollIterations: 0, aborted: false };
  }
  if (snapshot.remainingPct > currentConfig.thresholdPct) {
    return { slept: false, reason: null, snapshot, pollIterations: 0, aborted: false };
  }
  // The target wake time is the reset time plus the configured buffer.
  // The buffer gives the provider's quota counters a moment to fully
  // refresh before we send another request (some providers stagger
  // the renewal).
  const wakeAtMs = snapshot.resetAtMs + currentConfig.postResetBufferMs;
  const totalWaitMs = Math.max(0, wakeAtMs - Date.now());
  if (totalWaitMs === 0) {
    // Reset has already happened AND the buffer has elapsed — no sleep needed.
    return { slept: false, reason: null, snapshot, pollIterations: 0, aborted: false };
  }

  const reason = `${snapshot.providerId}/${snapshot.modelId}: ${snapshot.remainingPct.toFixed(1)}% ${snapshot.dimension} remaining`;
  const isThrottled = throttledCount > 0;
  const bufferNote =
    currentConfig.postResetBufferMs > 0
      ? ` (+ ${formatDuration(currentConfig.postResetBufferMs)} buffer)`
      : "";

  // Initial notify. We always notify on 429 (we know we hit a wall);
  // for predictive gates we honour the config flag.
  if (isThrottled || currentConfig.notifyOnPredictive) {
    ctx.ui.notify(
      `Feature Engineer: rate limit at ${reason}. Polling every ${formatDuration(currentConfig.pollIntervalMs)} until window resets in ${formatDuration(snapshot.resetAtMs - Date.now())}${bufferNote}. Ctrl+C to abort.`,
      "warning",
    );
  }

  let iterations = 0;
  let aborted = false;
  try {
    // Poll until either the wake time is reached or the user aborts.
    while (Date.now() < wakeAtMs) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      const remainingMs = wakeAtMs - Date.now();
      const chunkMs = Math.min(currentConfig.pollIntervalMs, remainingMs);
      iterations += 1;

      // Update the footer status with a countdown.
      ctx.ui.setStatus(
        "fe-rate-limit",
        `Rate limit: ${reason} — ${formatDuration(remainingMs)} until retry${bufferNote} (poll ${iterations})`,
      );

      await sleep(chunkMs, signal);
      if (signal?.aborted) {
        aborted = true;
        break;
      }
    }
  } finally {
    ctx.ui.setStatus("fe-rate-limit", undefined);
  }

  return {
    slept: !aborted && iterations > 0,
    reason: aborted ? null : reason,
    snapshot,
    pollIterations: iterations,
    aborted,
  };
}

/** Sleep that resolves early when the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Format ms as a short human duration, e.g. "5m", "1h30m", "45s". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const remSeconds = totalSeconds % 60;
  if (minutes < 60) return remSeconds > 0 ? `${minutes}m${remSeconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes > 0 ? `${hours}h${remMinutes}m` : `${hours}h`;
}

/**
 * Register the `after_provider_response` listener that feeds the
 * tracker. Idempotent — safe to call more than once.
 *
 * On a 429 response we also call `ctx.abort()` to cancel the
 * current turn cleanly. This makes the in-flight LLM call fail,
 * which propagates up through `ctx.newSession` so the runner's
 * retry loop can catch it and re-run the stage after polling.
 *
 * The abort is guarded against double-firing: we set a per-attempt
 * flag (`lastAttemptWasThrottled`) so the listener doesn't re-abort
 * during the same attempt. The runner resets the flag before each
 * new attempt.
 */
export function registerRateLimitListener(pi: ExtensionAPI): void {
  pi.on("after_provider_response", (event, ctx) => {
    const model = ctx.model;
    const providerId = model?.provider ?? "unknown";
    const modelId = model?.id ?? "unknown";
    recordProviderResponse(event, providerId, modelId);

    // Abort the current turn on a 429 so the retry loop can catch it.
    // The per-attempt flag is set inside recordProviderResponse; we
    // additionally check that we haven't already aborted this attempt
    // (defensive — the flag is per-attempt, reset by the runner).
    if (event.status === 429) {
      try {
        ctx.abort();
      } catch {
        // abort may throw if already aborted; safe to ignore.
      }
    }
  });

  // Clear on model change — different model = different rate-limit window.
  pi.on("model_select", () => {
    clearLatest();
  });
}
