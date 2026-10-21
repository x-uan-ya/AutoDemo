import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

/**
 * Password hashing using scrypt from Node's standard library.
 *
 * scrypt is a modern, memory-hard password-hashing algorithm and is built into
 * Node, so we add no third-party dependency. Each password gets a unique random
 * salt; the stored string is self-describing (algorithm + parameters + salt +
 * hash) so parameters can evolve without a migration.
 *
 * Rules enforced here:
 *   - Never store or return a plaintext password.
 *   - Never log a password or a hash.
 *   - Verification is constant-time (timingSafeEqual) to avoid leaking info via
 *     timing.
 */

/** Promise wrapper that preserves scrypt's options argument (keylen + options). */
function scrypt(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

// scrypt cost parameters. N must be a power of two. These are a reasonable
// interactive-login cost; raise N as hardware improves.
const N = 16_384; // CPU/memory cost
const r = 8; // block size
const p = 1; // parallelization
const KEY_LEN = 64;
const SALT_LEN = 16;

const PREFIX = "scrypt";

/** Minimum/maximum password length. Upper bound prevents scrypt DoS. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordError";
  }
}

/** Validate password complexity. Returns null if ok, else a user-safe message. */
export function validatePasswordStrength(password: string): string | null {
  if (typeof password !== "string") return "Password is required.";
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password must be at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

/**
 * Hash a plaintext password. Returns an encoded string safe to persist:
 *   scrypt$N$r$p$<saltBase64>$<hashBase64>
 */
export async function hashPassword(password: string): Promise<string> {
  const strength = validatePasswordStrength(password);
  if (strength) throw new PasswordError(strength);

  const salt = randomBytes(SALT_LEN);
  const derived = (await scrypt(password, salt, KEY_LEN, { N, r, p })) as Buffer;
  return [
    PREFIX,
    N,
    r,
    p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

/**
 * Verify a plaintext password against a stored encoded hash. Returns false for
 * any malformed stored value rather than throwing, so a corrupt record can
 * never be mistaken for a match. Constant-time comparison.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  if (password.length > MAX_PASSWORD_LENGTH) return false;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== PREFIX) return false;

  const nParam = Number(parts[1]);
  const rParam = Number(parts[2]);
  const pParam = Number(parts[3]);
  if (!Number.isInteger(nParam) || !Number.isInteger(rParam) || !Number.isInteger(pParam)) {
    return false;
  }

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[4], "base64");
    expected = Buffer.from(parts[5], "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let derived: Buffer;
  try {
    derived = (await scrypt(password, salt, expected.length, {
      N: nParam,
      r: rParam,
      p: pParam,
      // Allow enough memory for the configured cost.
      maxmem: 256 * 1024 * 1024,
    })) as Buffer;
  } catch {
    return false;
  }

  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
