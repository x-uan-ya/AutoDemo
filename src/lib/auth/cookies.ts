import { cookies } from "next/headers";

/**
 * Session cookie configuration and helpers.
 *
 * Security properties:
 *   - HttpOnly: the session id is never readable by JavaScript (no localStorage,
 *     no document.cookie access), which blocks token theft via XSS.
 *   - Secure (production only): the cookie is only sent over HTTPS. Disabled in
 *     development so localhost over http still works.
 *   - SameSite=Lax: the cookie is not sent on cross-site POST/fetch, a strong
 *     baseline CSRF defense; combined with the CSRF token for defense in depth.
 *   - Path=/: valid for the whole app.
 *   - __Host- prefix in production: the browser enforces Secure + Path=/ + no
 *     Domain, preventing subdomain cookie injection.
 *
 * The CSRF token is stored in a SEPARATE, non-HttpOnly cookie so the frontend
 * can read it and echo it in the x-csrf-token header (double-submit pattern).
 * The authoritative copy lives in the server-side session; the cookie is only a
 * transport for the client to read.
 */

const isProd = process.env.NODE_ENV === "production";

/** Session cookie name. __Host- prefix in prod for strict browser enforcement. */
export const SESSION_COOKIE = isProd ? "__Host-ad_sid" : "ad_sid";
/** CSRF token cookie (readable by JS). */
export const CSRF_COOKIE = isProd ? "__Host-ad_csrf" : "ad_csrf";

/** TTL used for cookie maxAge (seconds). Mirrors the session TTL default. */
function cookieMaxAgeSec(): number {
  const raw = process.env.SESSION_TTL_MS;
  const ms = raw ? Number(raw) : NaN;
  const ttl = Number.isFinite(ms) && ms > 0 ? ms : 12 * 60 * 60 * 1000;
  return Math.floor(ttl / 1000);
}

/** Set the session + CSRF cookies after login/registration. */
export async function setSessionCookies(sid: string, csrfToken: string): Promise<void> {
  const store = await cookies();
  const maxAge = cookieMaxAgeSec();

  store.set(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  // Readable by the client so it can echo the token back in a header.
  store.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

/** Clear both cookies on logout. */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  store.set(CSRF_COOKIE, "", {
    httpOnly: false,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Read the session id from the request cookies (server-side). */
export async function readSessionId(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Read the session id directly from a Request's Cookie header. Used in contexts
 * (route guards) where we have the Request but want to avoid the dynamic
 * cookies() store. Falls back to simple header parsing.
 */
export function readSessionIdFromRequest(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join("="));
  }
  return null;
}
