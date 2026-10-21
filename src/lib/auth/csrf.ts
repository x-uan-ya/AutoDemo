import { timingSafeEqual } from "node:crypto";
import type { SessionRecord } from "./session-store";

/**
 * CSRF protection (double-submit, bound to the server session).
 *
 * Because authentication uses a cookie, a cross-site page could trigger a
 * state-changing request that rides on the user's session cookie. SameSite=Lax
 * blocks the common cases, but we add a token check as defense in depth and to
 * cover edge cases (e.g. top-level POST navigations).
 *
 * The authoritative CSRF token lives in the server-side session record. The
 * client receives a copy in a readable cookie and must echo it back in the
 * `x-csrf-token` header on every unsafe request. The header is compared,
 * constant-time, to the session's token. An attacker on another origin cannot
 * read the token cookie (same-origin policy) and so cannot forge the header.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-csrf-token";

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method.toUpperCase());
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Verify the CSRF token for an unsafe (state-changing) request against the
 * session. Returns true when the request may proceed. Safe methods always pass.
 */
export function verifyCsrf(request: Request, session: SessionRecord): boolean {
  if (isSafeMethod(request.method)) return true;
  const presented = request.headers.get(CSRF_HEADER);
  if (!presented) return false;
  return constantTimeEqual(presented, session.csrfToken);
}
