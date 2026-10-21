/**
 * Redis client wiring for shared coordination state (rate limiting +
 * concurrency gate).
 *
 * Design goals:
 *   - No hardcoded URLs/credentials. All connection config comes from env.
 *   - The build does not hard-depend on a Redis driver: `ioredis` is loaded
 *     lazily and only when Redis is configured. Install it in production
 *     (`npm i ioredis`); local dev/tests that don't configure Redis never load
 *     it.
 *   - The rest of the app depends only on the small `RedisLike` surface below,
 *     so a fake can be injected in tests and the stores are identical in prod
 *     and test (both go through `eval`, preserving atomicity semantics).
 *
 * Environment variables:
 *   - REDIS_URL           e.g. redis://:password@host:6379/0  (preferred)
 *   - REDIS_TLS           "true" to force TLS (rediss:// also implies TLS)
 *   - SHARED_STATE_BACKEND  "redis" | "memory" (optional explicit override)
 *
 * NEVER commit real values — see .env.example.
 */

/** The minimal Redis command surface the shared-state stores rely on. */
export interface RedisLike {
  /** Run a Lua script atomically. Mirrors ioredis `eval`. */
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
  /** Delete one or more keys. */
  del(...keys: string[]): Promise<number>;
  /** Liveness check. */
  ping(): Promise<string>;
}

export type SharedStateBackend = "redis" | "memory";

/**
 * Decide which backend to use.
 *   - Explicit SHARED_STATE_BACKEND wins.
 *   - Else "redis" when REDIS_URL is set, otherwise "memory".
 */
export function selectedBackend(): SharedStateBackend {
  const explicit = process.env.SHARED_STATE_BACKEND?.trim().toLowerCase();
  if (explicit === "redis" || explicit === "memory") return explicit;
  return process.env.REDIS_URL?.trim() ? "redis" : "memory";
}

export function isRedisConfigured(): boolean {
  return selectedBackend() === "redis";
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Enforce that production uses a shared backend. A multi-instance production
 * deployment with in-memory limiters/concurrency silently multiplies the
 * effective limits by the instance count, so we refuse to run that way.
 *
 * Opt out ONLY for a deliberate single-instance production by setting
 * SHARED_STATE_BACKEND=memory explicitly (we then warn loudly).
 *
 * Call this once at startup (see instrumentation).
 */
export function assertProductionHasRedis(): void {
  if (!isProduction()) return;

  const explicit = process.env.SHARED_STATE_BACKEND?.trim().toLowerCase();
  if (explicit === "memory") {
    console.warn(
      "[shared-state] WARNING: SHARED_STATE_BACKEND=memory in production. " +
        "Rate limiting and concurrency control are PER-PROCESS and will NOT " +
        "hold across multiple instances. Only safe for a single instance."
    );
    return;
  }

  if (!isRedisConfigured()) {
    throw new Error(
      "[shared-state] Redis is required in production for shared rate limiting " +
        "and concurrency control. Set REDIS_URL (or, for a deliberate " +
        "single-instance deployment, SHARED_STATE_BACKEND=memory). Refusing to " +
        "start with unsafe per-process limits."
    );
  }
}

// ---------------------------------------------------------------------------
// Lazy ioredis-backed client (singleton)
// ---------------------------------------------------------------------------

const globalForRedis = globalThis as unknown as {
  __autodemoRedis?: RedisLike | null;
};

/**
 * Get the shared Redis client, or null when Redis is not configured. The driver
 * is imported lazily so the app runs without `ioredis` installed when Redis is
 * not used. Throws a clear error if Redis is configured but the driver is
 * missing.
 */
export async function getRedis(): Promise<RedisLike | null> {
  if (!isRedisConfigured()) return null;
  if (globalForRedis.__autodemoRedis !== undefined) {
    return globalForRedis.__autodemoRedis;
  }

  const url = process.env.REDIS_URL!.trim();
  let IoRedis: unknown;
  try {
    // Lazy, optional dependency. Bundlers must not eagerly resolve this.
    const mod: unknown = await import(/* webpackIgnore: true */ "ioredis");
    IoRedis = (mod as { default?: unknown }).default ?? mod;
  } catch {
    throw new Error(
      "[shared-state] REDIS_URL is set but the 'ioredis' package is not " +
        "installed. Run `npm install ioredis` in the deployment that uses Redis."
    );
  }

  const useTls =
    process.env.REDIS_TLS?.trim().toLowerCase() === "true" ||
    url.startsWith("rediss://");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = IoRedis as any;
  const client = new Ctor(url, {
    ...(useTls ? { tls: {} } : {}),
    // Fail fast rather than queueing forever if Redis is down.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
  }) as RedisLike;

  globalForRedis.__autodemoRedis = client;
  return client;
}

/** Test seam: inject a RedisLike (e.g. a fake) and force the redis backend. */
export function __setRedisForTests(client: RedisLike | null): void {
  globalForRedis.__autodemoRedis = client ?? undefined;
}
