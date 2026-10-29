import { randomBytes } from "node:crypto";

/**
 * Server-side session store.
 *
 * Sessions live entirely on the server; the client holds only an opaque,
 * high-entropy session id in an HttpOnly cookie. This means:
 *   - the session id is not a JWT and carries no claims the client can read,
 *   - logout truly invalidates the session (we delete the server record),
 *   - session fixation is prevented by rotating the id after login.
 *
 * In-memory today, behind a small interface so a Redis-backed store (SET with
 * TTL) can replace it for multi-instance production without changing callers.
 */

export interface SessionRecord {
  userId: string;
  /** CSRF token bound to this session (double-submit defense). */
  csrfToken: string;
  createdAt: number;
  /** Absolute expiry (ms epoch). */
  expiresAt: number;
}

export interface SessionStore {
  create(userId: string): Promise<{ sid: string; record: SessionRecord }>;
  get(sid: string): Promise<SessionRecord | null>;
  /** Delete a session (logout). */
  destroy(sid: string): Promise<void>;
  /**
   * Rotate the session id for an existing session's user, destroying the old
   * id. Used immediately after login to prevent session fixation.
   */
  rotate(oldSid: string, userId: string): Promise<{ sid: string; record: SessionRecord }>;
}

/** Session lifetime in ms. Override via SESSION_TTL_MS (default 12h). */
function sessionTtlMs(): number {
  const raw = process.env.SESSION_TTL_MS;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 12 * 60 * 60 * 1000;
}

/** 256 bits of entropy, URL-safe. */
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>();

  private makeRecord(userId: string): SessionRecord {
    const now = Date.now();
    return {
      userId,
      csrfToken: newToken(),
      createdAt: now,
      expiresAt: now + sessionTtlMs(),
    };
  }

  async create(userId: string): Promise<{ sid: string; record: SessionRecord }> {
    const sid = newToken();
    const record = this.makeRecord(userId);
    this.sessions.set(sid, record);
    this.sweep();
    return { sid, record };
  }

  async get(sid: string): Promise<SessionRecord | null> {
    if (!sid) return null;
    const record = this.sessions.get(sid);
    if (!record) return null;
    if (record.expiresAt <= Date.now()) {
      // Expired sessions are invalid and are cleaned up on read.
      this.sessions.delete(sid);
      return null;
    }
    return record;
  }

  async destroy(sid: string): Promise<void> {
    if (sid) this.sessions.delete(sid);
  }

  async rotate(
    oldSid: string,
    userId: string
  ): Promise<{ sid: string; record: SessionRecord }> {
    if (oldSid) this.sessions.delete(oldSid);
    return this.create(userId);
  }

  /** Opportunistically drop expired sessions to bound memory. */
  private sweep(): void {
    if (this.sessions.size < 5_000) return;
    const now = Date.now();
    for (const [sid, rec] of this.sessions) {
      if (rec.expiresAt <= now) this.sessions.delete(sid);
    }
  }
}

/**
 * PostgreSQL-backed session store (Neon / Lakebase). Sessions survive restarts
 * and are shared across instances. Same guarantees as the in-memory store:
 * expiry is enforced on read, logout deletes the row, and login rotates the id.
 */
export class PgSessionStore implements SessionStore {
  private makeRecord(userId: string): SessionRecord {
    const now = Date.now();
    return {
      userId,
      csrfToken: newToken(),
      createdAt: now,
      expiresAt: now + sessionTtlMs(),
    };
  }

  async create(userId: string): Promise<{ sid: string; record: SessionRecord }> {
    const { query } = await import("@/lib/db/pg");
    const sid = newToken();
    const record = this.makeRecord(userId);
    await query(
      "INSERT INTO sessions (sid, user_id, csrf_token, created_at, expires_at) VALUES ($1, $2, $3, to_timestamp($4), to_timestamp($5))",
      [sid, record.userId, record.csrfToken, record.createdAt / 1000, record.expiresAt / 1000]
    );
    return { sid, record };
  }

  async get(sid: string): Promise<SessionRecord | null> {
    if (!sid) return null;
    const { query } = await import("@/lib/db/pg");
    const rows = await query<{
      user_id: string;
      csrf_token: string;
      created_at: Date;
      expires_at: Date;
    }>(
      "SELECT user_id, csrf_token, created_at, expires_at FROM sessions WHERE sid = $1",
      [sid]
    );
    const row = rows[0];
    if (!row) return null;

    const expiresAt = new Date(row.expires_at).getTime();
    if (expiresAt <= Date.now()) {
      // Expired: invalid, and clean it up.
      await query("DELETE FROM sessions WHERE sid = $1", [sid]);
      return null;
    }
    return {
      userId: row.user_id,
      csrfToken: row.csrf_token,
      createdAt: new Date(row.created_at).getTime(),
      expiresAt,
    };
  }

  async destroy(sid: string): Promise<void> {
    if (!sid) return;
    const { query } = await import("@/lib/db/pg");
    await query("DELETE FROM sessions WHERE sid = $1", [sid]);
  }

  async rotate(
    oldSid: string,
    userId: string
  ): Promise<{ sid: string; record: SessionRecord }> {
    if (oldSid) await this.destroy(oldSid);
    return this.create(userId);
  }
}

const globalForSessions = globalThis as unknown as { __autodemoSessionStore?: SessionStore };

export function getSessionStore(): SessionStore {
  if (!globalForSessions.__autodemoSessionStore) {
    globalForSessions.__autodemoSessionStore = process.env.DATABASE_URL?.trim()
      ? new PgSessionStore()
      : new InMemorySessionStore();
  }
  return globalForSessions.__autodemoSessionStore;
}

/** Test seam: force a specific session store. */
export function __setSessionStore(store: SessionStore | null): void {
  globalForSessions.__autodemoSessionStore = store ?? undefined;
}
