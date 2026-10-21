import { NextResponse, type NextRequest } from "next/server";

/**
 * CORS allowlist for the API (Next.js 16 "proxy" convention, formerly
 * "middleware").
 *
 * The API is credentialed (it uses a session cookie), so a wildcard
 * `Access-Control-Allow-Origin: *` is forbidden — browsers reject wildcard +
 * credentials, and it would be unsafe anyway. Instead we reflect an Origin only
 * when it is on an explicit allowlist supplied via the CORS_ALLOWED_ORIGINS env
 * var (comma-separated). Same-origin requests send no Origin header and are
 * unaffected.
 *
 * Unexpected cross-origin requests receive NO CORS headers, so the browser
 * blocks the response from being read. Cross-origin preflights (OPTIONS) from
 * disallowed origins get 403.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "";

function allowedOrigins(): Set<string> {
  const raw = process.env.CORS_ALLOWED_ORIGINS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // Always trust the app's own configured origin, if set.
  if (APP_URL) list.push(APP_URL.trim());
  return new Set(list);
}

function isAllowed(origin: string): boolean {
  return allowedOrigins().has(origin);
}

function applyCorsHeaders(res: NextResponse, origin: string): void {
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, x-csrf-token");
  res.headers.set("Access-Control-Max-Age", "600");
}

export function proxy(request: NextRequest) {
  const origin = request.headers.get("origin");

  // No Origin header => same-origin or non-CORS request. Let it through
  // untouched; authentication/CSRF are enforced in the route layer.
  if (!origin) return NextResponse.next();

  const allowed = isAllowed(origin);

  // Preflight.
  if (request.method === "OPTIONS") {
    if (!allowed) {
      return new NextResponse(null, { status: 403 });
    }
    const res = new NextResponse(null, { status: 204 });
    applyCorsHeaders(res, origin);
    return res;
  }

  // Actual request from a cross-origin caller.
  const res = NextResponse.next();
  if (allowed) {
    applyCorsHeaders(res, origin);
  }
  // When not allowed we deliberately set no ACAO header; the browser blocks the
  // cross-origin read. (We do not hard-403 to keep same-site tooling simple.)
  return res;
}

export const config = {
  // Only guard the API surface.
  matcher: ["/api/:path*"],
};
