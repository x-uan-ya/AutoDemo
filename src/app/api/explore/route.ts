import { NextResponse } from "next/server";
import { z } from "zod";
import { exploreWebsite } from "@/lib/browser/browser-explorer";
import { ExplorerError, type ExplorerErrorCode } from "@/lib/browser/types";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { MAX_URL_LENGTH } from "@/lib/security/limits";
import { safeErrorResponse } from "@/lib/security/errors";
import { logSecurityEvent } from "@/lib/security/log";
import { authenticate } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";

/**
 * POST /api/explore
 *
 * Request:  { "url": "https://example.com" }
 * Response: { "success": true, "data": WebsiteExploration }
 *        or { "success": false, "error": { "code", "message" } }
 *
 * This route runs the Playwright explorer, which needs the Node.js runtime
 * (not Edge) and can take tens of seconds.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  url: z
    .string()
    .min(1, "A URL is required.")
    .max(MAX_URL_LENGTH, "URL is too long."),
});

/** Map explorer error categories to HTTP status codes. */
const STATUS_BY_CODE: Record<ExplorerErrorCode, number> = {
  invalid_url: 400,
  blocked_url: 400,
  http_error: 502,
  unreachable: 502,
  timeout: 504,
  browser_error: 500,
};

export async function POST(request: Request) {
  // Rate limit before doing any work (the explorer is expensive).
  const limited = await enforceRateLimit(request, "explore", "/api/explore");
  if (limited) return limited;

  // The explorer is an expensive, SSRF-sensitive operation — require an
  // authenticated user (no demo ownership check: this does not touch a demo).
  const auth = await authenticate(request);
  if (!auth) {
    logSecurityEvent("authz_denied", { route: "/api/explore", reason: "unauthenticated" });
    return NextResponse.json(
      { success: false, error: { code: "unauthenticated", message: "You must be signed in to do that." } },
      { status: 401 }
    );
  }
  // CSRF: this is a state-changing POST triggered by a cookie-authenticated UI.
  if (!verifyCsrf(request, auth.session)) {
    logSecurityEvent("authz_denied", { route: "/api/explore", reason: "csrf", principal: auth.user.id });
    return NextResponse.json(
      { success: false, error: { code: "csrf_failed", message: "Invalid or missing CSRF token." } },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "invalid_url", message: "Request body must be JSON." },
      },
      { status: 400 }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "invalid_url",
          message: parsed.error.issues[0]?.message ?? "Invalid request.",
        },
      },
      { status: 400 }
    );
  }

  try {
    const data = await exploreWebsite(parsed.data.url);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof ExplorerError) {
      if (err.code === "blocked_url") {
        logSecurityEvent("ssrf_blocked", { route: "/api/explore", reason: err.message });
      }
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: STATUS_BY_CODE[err.code] }
      );
    }
    // Unexpected error: generic client message, detailed server-side log.
    return safeErrorResponse(err, {
      route: "/api/explore",
      status: 500,
      code: "browser_error",
      clientMessage: "An unexpected error occurred while exploring the website.",
    });
  }
}
