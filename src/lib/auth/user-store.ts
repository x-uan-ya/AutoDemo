import { secureId } from "@/lib/security/ids";
import { hashPassword, verifyPassword } from "./password";

/**
 * User account store.
 *
 * Mirrors the repository pattern used for demo jobs: a small interface with an
 * in-memory implementation today, swappable for a database-backed one later
 * without touching call sites. Passwords are only ever stored as scrypt hashes.
 *
 * Email handling: emails are normalized (trimmed + lowercased) before lookup
 * and storage so "A@x.com" and "a@x.com" are the same account.
 */

export interface User {
  id: string;
  email: string;
  /** Encoded scrypt hash — never a plaintext password. */
  passwordHash: string;
  createdAt: string;
}

/** Public view of a user — never includes the password hash. */
export interface PublicUser {
  id: string;
  email: string;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

export class UserExistsError extends Error {
  constructor() {
    super("An account with that email already exists.");
    this.name = "UserExistsError";
  }
}

export interface UserStore {
  create(email: string, password: string): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  /**
   * Verify a login. Returns the user on success, null on failure. Performs a
   * dummy hash when the email is unknown so response timing does not reveal
   * whether the account exists.
   */
  verifyCredentials(email: string, password: string): Promise<User | null>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const e = normalizeEmail(email);
  return e.length > 0 && e.length <= 254 && EMAIL_RE.test(e);
}

/**
 * A pre-computed valid hash used as a decoy when an email is not found. This
 * keeps verifyCredentials' timing roughly constant between "no such user" and
 * "wrong password", so the API does not leak which emails are registered.
 * (It is the hash of a random throwaway value; it can never match real input.)
 */
let decoyHashPromise: Promise<string> | null = null;
function getDecoyHash(): Promise<string> {
  if (!decoyHashPromise) {
    decoyHashPromise = hashPassword(secureId("decoy") + secureId("decoy"));
  }
  return decoyHashPromise;
}

export class InMemoryUserStore implements UserStore {
  private usersByEmail = new Map<string, User>();
  private usersById = new Map<string, User>();

  async create(email: string, password: string): Promise<User> {
    const normalized = normalizeEmail(email);
    if (this.usersByEmail.has(normalized)) {
      throw new UserExistsError();
    }
    const user: User = {
      id: secureId("user"),
      email: normalized,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    this.usersByEmail.set(normalized, user);
    this.usersById.set(user.id, user);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersByEmail.get(normalizeEmail(email)) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.usersById.get(id) ?? null;
  }

  async verifyCredentials(email: string, password: string): Promise<User | null> {
    const user = this.usersByEmail.get(normalizeEmail(email)) ?? null;
    if (!user) {
      // Spend comparable time to avoid user-enumeration via timing.
      await verifyPassword(password, await getDecoyHash());
      return null;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }
}

/**
 * PostgreSQL-backed user store (Neon / Lakebase). Persists accounts across
 * restarts and shares them across instances. Same timing-safe verification and
 * user-enumeration resistance as the in-memory store.
 */
export class PgUserStore implements UserStore {
  async create(email: string, password: string): Promise<User> {
    const { query } = await import("@/lib/db/pg");
    const normalized = normalizeEmail(email);
    const user: User = {
      id: secureId("user"),
      email: normalized,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
    };
    try {
      await query(
        "INSERT INTO users (id, email, password_hash, created_at) VALUES ($1, $2, $3, $4)",
        [user.id, user.email, user.passwordHash, user.createdAt]
      );
    } catch (err) {
      // Unique violation on email -> account already exists.
      if (err && typeof err === "object" && (err as { code?: string }).code === "23505") {
        throw new UserExistsError();
      }
      throw err;
    }
    return user;
  }

  private async rowToUser(
    row: { id: string; email: string; password_hash: string; created_at: Date | string } | undefined
  ): Promise<User | null> {
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  }

  async findByEmail(email: string): Promise<User | null> {
    const { query } = await import("@/lib/db/pg");
    const rows = await query<{
      id: string;
      email: string;
      password_hash: string;
      created_at: Date | string;
    }>("SELECT id, email, password_hash, created_at FROM users WHERE email = $1", [
      normalizeEmail(email),
    ]);
    return this.rowToUser(rows[0]);
  }

  async findById(id: string): Promise<User | null> {
    const { query } = await import("@/lib/db/pg");
    const rows = await query<{
      id: string;
      email: string;
      password_hash: string;
      created_at: Date | string;
    }>("SELECT id, email, password_hash, created_at FROM users WHERE id = $1", [id]);
    return this.rowToUser(rows[0]);
  }

  async verifyCredentials(email: string, password: string): Promise<User | null> {
    const user = await this.findByEmail(email);
    if (!user) {
      // Spend comparable time to avoid user-enumeration via timing.
      await verifyPassword(password, await getDecoyHash());
      return null;
    }
    const ok = await verifyPassword(password, user.passwordHash);
    return ok ? user : null;
  }
}

const globalForUsers = globalThis as unknown as { __autodemoUserStore?: UserStore };

export function getUserStore(): UserStore {
  if (!globalForUsers.__autodemoUserStore) {
    // Use Postgres when a connection string is configured; otherwise fall back
    // to the in-memory store (local dev / tests / no DB configured).
    globalForUsers.__autodemoUserStore = process.env.DATABASE_URL?.trim()
      ? new PgUserStore()
      : new InMemoryUserStore();
  }
  return globalForUsers.__autodemoUserStore;
}

/** Test seam: force a specific user store. */
export function __setUserStore(store: UserStore | null): void {
  globalForUsers.__autodemoUserStore = store ?? undefined;
}
