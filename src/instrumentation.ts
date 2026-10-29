/**
 * Next.js instrumentation hook — runs once when the server process starts.
 *
 * We use it to make the shared-state backend explicit at startup and to refuse
 * to run production with unsafe per-process limiters/concurrency. See
 * src/lib/redis/client.ts.
 */
export async function register(): Promise<void> {
  // Only relevant on the Node.js server runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertProductionHasRedis, selectedBackend } = await import(
    "@/lib/redis/client"
  );

  // Throws in production if Redis is required but not configured.
  assertProductionHasRedis();

  const backend = selectedBackend();
  console.info(
    `[shared-state] backend=${backend} ` +
      `(rate limiting + concurrency gate ${
        backend === "redis" ? "shared across instances via Redis" : "PER-PROCESS"
      })`
  );

  // Persistence backend for users + sessions.
  const { isPostgresConfigured } = await import("@/lib/db/pg");
  if (isPostgresConfigured()) {
    console.info(
      "[persistence] users + sessions: PostgreSQL (accounts/sessions persist across restarts)"
    );
  } else {
    console.warn(
      "[persistence] users + sessions: IN-MEMORY (dev only — accounts and " +
        "sessions are LOST on restart). Set DATABASE_URL to persist."
    );
  }
}
