/**
 * Centralized, configurable resource limits.
 *
 * A malicious user must not be able to make AutoDemo consume unlimited CPU,
 * RAM, browser instances, storage, rendering time, or API spend. These limits
 * are enforced across the explorer, executor, recorder, and API routes.
 *
 * All values can be overridden via environment variables (see .env.example).
 */

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Maximum length of a user-submitted URL. */
export const MAX_URL_LENGTH = intEnv("MAX_URL_LENGTH", 2048);

/** Maximum number of pages a single exploration may open. */
export const MAX_PAGES_PER_EXPLORATION = intEnv("MAX_PAGES_PER_EXPLORATION", 1);

/** Maximum crawl depth (reserved for future multi-page crawling). */
export const MAX_CRAWL_DEPTH = intEnv("MAX_CRAWL_DEPTH", 1);

/** Hard cap on total browser wall-clock time per operation (ms). */
export const MAX_BROWSER_TIME_MS = intEnv("MAX_BROWSER_TIME_MS", 120_000);

/** Maximum number of browser actions in a single demo. */
export const MAX_ACTIONS_PER_DEMO = intEnv("MAX_ACTIONS_PER_DEMO", 60);

/** Maximum rendered video duration (seconds). */
export const MAX_VIDEO_DURATION_S = intEnv("MAX_VIDEO_DURATION_S", 300);

/** Maximum size for any single generated/served file (bytes). */
export const MAX_FILE_SIZE_BYTES = intEnv("MAX_FILE_SIZE_BYTES", 200 * 1024 * 1024);

/** Maximum number of concurrent heavy jobs (browser/record/render) server-wide. */
export const MAX_CONCURRENT_JOBS = intEnv("MAX_CONCURRENT_JOBS", 2);

/** Maximum AI/vision/TTS calls attributable to a single job. */
export const MAX_AI_CALLS_PER_JOB = intEnv("MAX_AI_CALLS_PER_JOB", 40);

/** Maximum JSON request body size accepted by API routes (bytes). */
export const MAX_REQUEST_BODY_BYTES = intEnv("MAX_REQUEST_BODY_BYTES", 256 * 1024);

/** Snapshot object for logging / diagnostics. */
export const LIMITS = {
  MAX_URL_LENGTH,
  MAX_PAGES_PER_EXPLORATION,
  MAX_CRAWL_DEPTH,
  MAX_BROWSER_TIME_MS,
  MAX_ACTIONS_PER_DEMO,
  MAX_VIDEO_DURATION_S,
  MAX_FILE_SIZE_BYTES,
  MAX_CONCURRENT_JOBS,
  MAX_AI_CALLS_PER_JOB,
  MAX_REQUEST_BODY_BYTES,
} as const;

// ---------------------------------------------------------------------------
// Global concurrency gate for heavy jobs (browser/record/render)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { getRedis, isRedisConfigured } from "@/lib/redis/client";
import { ACQUIRE_SLOT_LUA, RELEASE_SLOT_LUA } from "@/lib/redis/scripts";
import { logSecurityEvent } from "./log";

/** A release handle; calling it frees the slot. Idempotent. */
export type ReleaseSlot = () => Promise<void>;

/**
 * Lease TTL for a heavy-job slot. A crashed/stuck worker's slot is reclaimed
 * after this long so it cannot be consumed forever. Must comfortably exceed the
 * longest heavy job (browser record/render). Override via JOB_SLOT_TTL_MS.
 */
export const JOB_SLOT_TTL_MS = intEnv("JOB_SLOT_TTL_MS", 10 * 60_000);

/** Redis key holding the set of active job leases. */
const SLOT_KEY = "autodemo:jobslots";

// ---- Memory backend (per-process; dev/test/single-instance) ----------------

interface MemoryLease {
  id: string;
  expiresAt: number;
}
const globalForJobs = globalThis as unknown as { __autodemoJobLeases?: Map<string, MemoryLease> };
function memLeases(): Map<string, MemoryLease> {
  if (!globalForJobs.__autodemoJobLeases) globalForJobs.__autodemoJobLeases = new Map();
  return globalForJobs.__autodemoJobLeases;
}
function memPrune(now: number): void {
  for (const [id, lease] of memLeases()) if (lease.expiresAt <= now) memLeases().delete(id);
}

function memAcquire(): ReleaseSlot | null {
  const now = Date.now();
  memPrune(now);
  if (memLeases().size >= MAX_CONCURRENT_JOBS) return null;
  const id = randomUUID();
  memLeases().set(id, { id, expiresAt: now + JOB_SLOT_TTL_MS });
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    memLeases().delete(id); // only ever removes THIS lease id
  };
}

// ---- Redis backend (shared across instances) -------------------------------

async function redisAcquire(): Promise<ReleaseSlot | null> {
  const redis = await getRedis();
  if (!redis) {
    // Redis is configured but unreachable: FAIL CLOSED. Do not grant unlimited
    // concurrency — deny the slot so the caller returns "server busy".
    logSecurityEvent("limit_exceeded", {
      resource: "job_slot",
      reason: "redis_unavailable_fail_closed",
    });
    return null;
  }
  const leaseId = randomUUID();
  try {
    const now = Date.now();
    const ok = (await redis.eval(
      ACQUIRE_SLOT_LUA,
      1,
      SLOT_KEY,
      MAX_CONCURRENT_JOBS,
      now,
      leaseId,
      JOB_SLOT_TTL_MS
    )) as number;
    if (Number(ok) !== 1) return null;
  } catch (err) {
    logSecurityEvent("limit_exceeded", {
      resource: "job_slot",
      reason: "redis_error_fail_closed",
      error: err instanceof Error ? err.message : "unknown",
    });
    return null; // fail closed
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      const r = await getRedis();
      // ARGV = leaseId; the Lua ZREM only removes THIS lease, never another's.
      if (r) await r.eval(RELEASE_SLOT_LUA, 1, SLOT_KEY, leaseId);
    } catch {
      // Release best-effort: if Redis is down, the lease TTL reclaims the slot.
    }
  };
}

/**
 * Try to claim a heavy-job slot. Resolves to a release function on success, or
 * null when at MAX_CONCURRENT_JOBS (or when the shared backend is unavailable —
 * fail closed). Always `await release()` in a finally block.
 *
 * Shared across instances when Redis is configured; per-process otherwise.
 */
export async function acquireJobSlot(): Promise<ReleaseSlot | null> {
  return isRedisConfigured() ? redisAcquire() : memAcquire();
}
