import { NextResponse } from "next/server";
import { logSecurityEvent } from "./log";
import { getRedis, isRedisConfigured } from "@/lib/redis/client";
import { RATE_LIMIT_LUA } from "@/lib/redis/scripts";

/**
 * Server-side rate limiting.
 *
 * Fixed-window limiter behind a small `RateLimitStore` interface. Two backends:
 *   - MemoryStore: per-process, for local dev / tests / single-instance.
 *   - RedisStore: shared across instances via an atomic Lua INCR+PEXPIRE, for
 *     multi-instance production. Selected automatically when Redis is
 *     configured (REDIS_URL / SHARED_STATE_BACKEND=redis).
 *
 * The public API (RATE_LIMITS, checkRateLimit, enforceRateLimit) is unchanged.
 *
 * WARNING: a per-process MemoryStore under N instances multiplies the effective
 * limit by ~N. Production must use Redis — see assertProductionHasRedis().
 */

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per key within the window. */
  max: number;
}

export interface RateLimitStore {
  /** Increment the counter for key; return the new count and reset time (ms epoch). */
  hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

/** In-memory fixed-window store. */
class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      this.buckets.set(key, fresh);
      // Opportunistic cleanup to bound memory.
      if (this.buckets.size > 10_000) {
        for (const [k, v] of this.buckets) if (v.resetAt <= now) this.buckets.delete(k);
      }
      return fresh;
    }
    existing.count += 1;
    return existing;
  }
}

/**
 * Redis-backed fixed-window store. Atomic via a Lua INCR+PEXPIRE so concurrent
 * instances share one counter and cannot race past the limit. Keys self-expire
 * via PEXPIRE, so stale windows disappear without cleanup.
 *
 * Fail-closed: if Redis errors, `hit` throws; the limiter treats that as "not
 * allowed" (see checkRateLimit) rather than silently permitting the request.
 */
class RedisStore implements RateLimitStore {
  async hit(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const redis = await getRedis();
    if (!redis) throw new Error("rate-limit: Redis not available");
    const now = Date.now();
    const res = (await redis.eval(RATE_LIMIT_LUA, 1, key, windowMs, now)) as [
      number,
      number
    ];
    const count = Number(res[0]);
    const resetAt = Number(res[1]);
    return { count, resetAt };
  }
}

const globalForRl = globalThis as unknown as { __autodemoRlStore?: RateLimitStore };
function getStore(): RateLimitStore {
  if (!globalForRl.__autodemoRlStore) {
    globalForRl.__autodemoRlStore = isRedisConfigured()
      ? new RedisStore()
      : new MemoryStore();
  }
  return globalForRl.__autodemoRlStore;
}

/** Test seam: force a specific store (e.g. RedisStore over a FakeRedis). */
export function __setRateLimitStore(store: RateLimitStore | null): void {
  globalForRl.__autodemoRlStore = store ?? undefined;
}

/** Per-endpoint rules. Expensive operations are stricter. */
export const RATE_LIMITS = {
  explore: { windowMs: 60_000, max: 10 },
  actions: { windowMs: 60_000, max: 20 },
  record: { windowMs: 300_000, max: 5 },
  voice: { windowMs: 300_000, max: 10 },
  render: { windowMs: 600_000, max: 5 },
  language: { windowMs: 600_000, max: 6 },
  // Auth endpoints: strict enough to blunt credential-stuffing / brute force,
  // loose enough that a legitimate user who mistypes a few times is fine.
  login: { windowMs: 300_000, max: 10 },
  register: { windowMs: 3_600_000, max: 5 },
  default: { windowMs: 60_000, max: 60 },
} as const satisfies Record<string, RateLimitRule>;

/**
 * Best-effort client key from the request. Uses forwarded/real-IP headers when
 * present (behind a proxy), else a constant (single-tenant dev). Never trusts
 * the value for anything but bucketing.
 */
export function clientKey(request: Request): string {
  const h = request.headers;
  const fwd = h.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return h.get("x-real-ip") ?? "anon";
}

export interface RateLimitResult {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSec: number;
}

/**
 * Check (and consume) one unit against a named bucket.
 *
 * Fail-closed: if the backing store errors (e.g. Redis is unavailable), we do
 * NOT silently allow the request — we return `ok: false` with a short
 * retry-after, so an outage cannot be used to bypass rate limits. A diagnostic
 * is logged.
 */
export async function checkRateLimit(
  bucket: keyof typeof RATE_LIMITS | RateLimitRule,
  key: string
): Promise<RateLimitResult> {
  const rule: RateLimitRule =
    typeof bucket === "string" ? RATE_LIMITS[bucket] : bucket;
  const name = typeof bucket === "string" ? bucket : "custom";

  let count: number;
  let resetAt: number;
  try {
    const res = await getStore().hit(`${name}:${key}`, rule.windowMs);
    count = res.count;
    resetAt = res.resetAt;
  } catch (err) {
    logSecurityEvent("rate_limited", {
      bucket: name,
      reason: "store_unavailable_fail_closed",
      error: err instanceof Error ? err.message : "unknown",
    });
    const retryAfterSec = Math.max(1, Math.ceil(rule.windowMs / 1000));
    return {
      ok: false,
      limit: rule.max,
      remaining: 0,
      resetAt: Date.now() + rule.windowMs,
      retryAfterSec,
    };
  }

  const remaining = Math.max(0, rule.max - count);
  const ok = count <= rule.max;
  return {
    ok,
    limit: rule.max,
    remaining,
    resetAt,
    retryAfterSec: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
  };
}

/**
 * Convenience guard for route handlers. Returns a 429 NextResponse when the
 * limit is exceeded, or null when the request may proceed. Adds standard
 * rate-limit headers in both cases is left to the caller; on 429 we set them.
 */
export async function enforceRateLimit(
  request: Request,
  bucket: keyof typeof RATE_LIMITS,
  route: string
): Promise<NextResponse | null> {
  const key = clientKey(request);
  const result = await checkRateLimit(bucket, key);
  if (result.ok) return null;

  logSecurityEvent("rate_limited", { route, bucket, key, limit: result.limit });
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "rate_limited",
        message: "Too many requests. Please slow down and try again shortly.",
      },
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    }
  );
}
