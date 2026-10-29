import { Pool, type PoolClient, type QueryResultRow } from "pg";

/**
 * PostgreSQL (Neon / Lakebase) connection pool.
 *
 * The app runs on the Node.js runtime (Playwright + Remotion force it), so per
 * the Neon connection guidance we use node-postgres (`pg`) with the POOLED
 * connection string (`DATABASE_URL`, hostname has the `-pooler` suffix) for
 * normal request traffic. Schema migrations use the DIRECT/unpooled string
 * (`DATABASE_URL_UNPOOLED`) — pooled connections route through PgBouncer in
 * transaction mode and don't support the session state migrations need.
 *
 * The pool is a singleton across dev hot-reloads via globalThis.
 */

const globalForPg = globalThis as unknown as { __autodemoPgPool?: Pool };

/** True when a Postgres connection string is configured. */
export function isPostgresConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL?.trim());
}

/** The pooled application pool. Throws if DATABASE_URL is not set. */
export function getPool(): Pool {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is not set.");
  }
  if (!globalForPg.__autodemoPgPool) {
    globalForPg.__autodemoPgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Neon requires TLS; the connection string carries sslmode=require, but
      // be explicit so a stray env override cannot disable it.
      ssl: { rejectUnauthorized: true },
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
  }
  return globalForPg.__autodemoPgPool;
}

/** Run a parameterized query against the pooled connection. */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: ReadonlyArray<unknown> = []
): Promise<T[]> {
  const pool = getPool();
  const res = await pool.query<T>(text, params as unknown[]);
  return res.rows;
}

/** Run a callback with a dedicated client (for transactions). */
export async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Liveness check used by startup/health diagnostics. */
export async function pingDatabase(): Promise<boolean> {
  const rows = await query<{ ok: number }>("SELECT 1 AS ok");
  return rows[0]?.ok === 1;
}
