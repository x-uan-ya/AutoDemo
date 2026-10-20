import { NextResponse } from "next/server";
import { logSecurityEvent } from "./log";

/**
 * Server-side rate limiting.
 *
 * In-memory fixed-window limiter behind a small interface so a Redis-backed
 * store can be dropped in for multi-instance production deployments without
 * changing call sites. Expensive endpoints use stricter limits.
 *
 * NOTE: the in-memory store is per-process. For horizontal scaling, implement
 * `RateLimitStore` against Redis (INCR + EXPIRE) and swap `store`.
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

const globalForRl = globalThis as unknown as { __autodemoRlStore?: RateLimitStore };
function getStore(): RateLimitStore {
  if (!globalForRl.__autodemoRlStore) globalForRl.__autodemoRlStore = new MemoryStore();
  return globalForRl.__autodemoRlStore;
}

/** Per-endpoint rules. Expensive operations are stricter. */
export const RATE_LIMITS = {
  explore: { windowMs: 60_000, max: 10 },
  actions: { windowMs: 60_000, max: 20 },
  record: { windowMs: 300_000, max: 5 },
  voice: { windowMs: 300_000, max: 10 },
  render: { windowMs: 600_000, max: 5 },
  language: { windowMs: 600_000, max: 6 },
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

/** Check (and consume) one unit against a named bucket. */
export async function checkRateLimit(
  bucket: keyof typeof RATE_LIMITS | RateLimitRule,
  key: string
): Promise<RateLimitResult> {
  const rule: RateLimitRule =
    typeof bucket === "string" ? RATE_LIMITS[bucket] : bucket;
  const name = typeof bucket === "string" ? bucket : "custom";
  const { count, resetAt } = await getStore().hit(`${name}:${key}`, rule.windowMs);
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
