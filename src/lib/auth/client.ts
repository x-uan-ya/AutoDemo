/**
 * Client-side API helper.
 *
 * Wraps fetch so that:
 *   - cookies are always sent (credentials: "same-origin"),
 *   - state-changing requests automatically carry the CSRF token read from the
 *     readable CSRF cookie, echoed in the x-csrf-token header (double-submit).
 *
 * The session cookie itself is HttpOnly and never touched here. Only the
 * non-HttpOnly CSRF companion cookie is read.
 */

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

/** Read the CSRF token from the readable companion cookie. */
function readCsrfToken(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "ad_csrf" || name === "__Host-ad_csrf") {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);

  if (!SAFE.has(method)) {
    const token = readCsrfToken();
    if (token) headers.set("x-csrf-token", token);
  }

  return fetch(input, {
    ...init,
    method,
    headers,
    credentials: "same-origin",
  });
}
