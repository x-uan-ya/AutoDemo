import { randomUUID } from "node:crypto";

/**
 * Cryptographically secure identifier generation.
 *
 * Security-sensitive IDs (demo ids double as access identifiers) must not be
 * predictable. Never use Math.random() for IDs. This wraps crypto.randomUUID().
 */
export function secureId(prefix?: string): string {
  const uuid = randomUUID();
  return prefix ? `${prefix}_${uuid}` : uuid;
}

/** A short, still-unguessable id (first 12 hex chars of a UUID, no dashes). */
export function shortSecureId(prefix?: string): string {
  const hex = randomUUID().replace(/-/g, "").slice(0, 12);
  return prefix ? `${prefix}_${hex}` : hex;
}
