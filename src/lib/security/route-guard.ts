import { NextResponse } from "next/server";
import { enforceRateLimit, type RATE_LIMITS } from "./rate-limit";
import {
  assertCanAccessDemo,
  AuthorizationError,
  AuthenticationError,
} from "./authz";
import { authenticate } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { logSecurityEvent } from "./log";
import { getRepository } from "@/lib/repository";
import type { DemoJob } from "@/types";

/**
 * Shared API route security guard.
 *
 * Centralizes the per-request security preamble so EVERY demo route enforces
 * the same checks in the same order:
 *   1. Rate limit                 -> 429 when exceeded.
 *   2. Authenticate               -> 401 when there is no valid session.
 *   3. CSRF (unsafe methods only) -> 403 when the token is missing/invalid.
 *   4. Load the demo + authorize  -> 404 when missing or not owned
 *      (non-enumerating: "not yours" and "not found" are indistinguishable).
 *
 * Knowledge of a demoId is never sufficient to pass. Returns either a
 * short-circuit NextResponse (caller returns it immediately) or the authorized
 * job to proceed with.
 */
export interface GuardResult {
  /** Present when the request should be rejected — return this immediately. */
  response?: NextResponse;
  /** Present on success — the authorized demo job. */
  job?: DemoJob;
}

function json(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ success: false, error: { code, message } }, { status });
}

export async function guardDemoRoute(
  request: Request,
  demoId: string,
  bucket: keyof typeof RATE_LIMITS,
  route: string
): Promise<GuardResult> {
  // 1. Rate limit.
  const limited = await enforceRateLimit(request, bucket, route);
  if (limited) return { response: limited };

  // 2. Authenticate.
  const auth = await authenticate(request);
  if (!auth) {
    logSecurityEvent("authz_denied", { route, reason: "unauthenticated" });
    return {
      response: json(401, "unauthenticated", "You must be signed in to do that."),
    };
  }

  // 3. CSRF for state-changing methods.
  if (!verifyCsrf(request, auth.session)) {
    logSecurityEvent("authz_denied", { route, reason: "csrf", principal: auth.user.id });
    return { response: json(403, "csrf_failed", "Invalid or missing CSRF token.") };
  }

  // 4. Authorize against demo ownership.
  const principal = { id: auth.user.id, authenticated: true };
  const job = await getRepository().getById(demoId);
  try {
    assertCanAccessDemo(principal, job ?? undefined, route);
  } catch (err) {
    if (err instanceof AuthenticationError) {
      return { response: json(401, "unauthenticated", "You must be signed in to do that.") };
    }
    if (err instanceof AuthorizationError) {
      // Do not reveal whether the demo exists but is not yours.
      return { response: json(404, "not_found", "Demo not found.") };
    }
    throw err;
  }

  return { job: job! };
}
