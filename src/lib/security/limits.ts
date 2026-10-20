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

const globalForJobs = globalThis as unknown as { __autodemoActiveJobs?: number };

function active(): number {
  return globalForJobs.__autodemoActiveJobs ?? 0;
}

/**
 * Try to claim a heavy-job slot. Returns a release function on success, or null
 * when the server is at MAX_CONCURRENT_JOBS. Always call the returned release
 * in a finally block.
 */
export function acquireJobSlot(): (() => void) | null {
  if (active() >= MAX_CONCURRENT_JOBS) return null;
  globalForJobs.__autodemoActiveJobs = active() + 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    globalForJobs.__autodemoActiveJobs = Math.max(0, active() - 1);
  };
}
