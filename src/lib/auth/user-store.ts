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

const globalForUsers = globalThis as unknown as { __autodemoUserStore?: UserStore };

export function getUserStore(): UserStore {
  if (!globalForUsers.__autodemoUserStore) {
    globalForUsers.__autodemoUserStore = new InMemoryUserStore();
  }
  return globalForUsers.__autodemoUserStore;
}
