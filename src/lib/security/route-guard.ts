import { NextResponse } from "next/server";
import { enforceRateLimit, type RATE_LIMITS } from "./rate-limit";
import { resolvePrincipal, assertCanAccessDemo, AuthorizationError } from "./authz";
import { getRepository } from "@/lib/repository";
import type { DemoJob } from "@/types";

/**
 * Shared API route security guard.
 *
 * Centralizes the per-request security preamble so every demo route enforces
 * the same checks in the same order:
 *   1. Rate limit (returns 429 when exceeded).
 *   2. Resolve the principal (anonymous until auth exists).
 *   3. Load the demo and assert the principal may access it (ownership
 *      boundary; today: exists-check, future: owner match).
 *
 * Returns either a short-circuit NextResponse (caller should return it) or the
 * loaded job to proceed with.
 */
export interface GuardResult {
  /** Present when the request should be rejected — return this immediately. */
  response?: NextResponse;
  /** Present on success — the authorized demo job. */
  job?: DemoJob;
}

export async function guardDemoRoute(
  request: Request,
  demoId: string,
  bucket: keyof typeof RATE_LIMITS,
  route: string
): Promise<GuardResult> {
  const limited = await enforceRateLimit(request, bucket, route);
  if (limited) return { response: limited };

  const principal = resolvePrincipal(request);
  const job = await getRepository().getById(demoId);

  try {
    assertCanAccessDemo(principal, job ?? undefined, route);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      // Do not reveal whether the demo exists but is not yours.
      return {
        response: NextResponse.json(
          { success: false, error: { code: "not_found", message: "Demo not found." } },
          { status: 404 }
        ),
      };
    }
    throw err;
  }

  return { job: job! };
}
