import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserStore, toPublicUser } from "@/lib/auth/user-store";
import { MAX_PASSWORD_LENGTH } from "@/lib/auth/password";
import { getSessionStore } from "@/lib/auth/session-store";
import { setSessionCookies, readSessionIdFromRequest } from "@/lib/auth/cookies";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { safeErrorResponse } from "@/lib/security/errors";
import { logSecurityEvent } from "@/lib/security/log";

/**
 * POST /api/auth/login
 *
 * Verifies email + password and establishes a session. Security properties:
 *   - Generic failure message (never reveals whether the email exists).
 *   - Session fixation prevented by rotating the session id on success (any
 *     pre-existing session cookie is destroyed and a fresh id is issued).
 *   - Rate limited to blunt brute-force / credential stuffing.
 *   - Password never logged.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

/** The single generic failure returned for every bad-credential case. */
function invalidCredentials() {
  return NextResponse.json(
    { success: false, error: { code: "invalid_credentials", message: "Invalid email or password." } },
    { status: 401 }
  );
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "login", "/api/auth/login");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "invalid_request", message: "Request body must be JSON." } },
      { status: 400 }
    );
  }

  const parsed = bodySchema.safeParse(body);
  // Even for a malformed body, return the generic credential error so the shape
  // of valid input is not revealed.
  if (!parsed.success) return invalidCredentials();

  try {
    const user = await getUserStore().verifyCredentials(parsed.data.email, parsed.data.password);
    if (!user) {
      logSecurityEvent("auth_login_failed", { route: "/api/auth/login" });
      return invalidCredentials();
    }

    // Session fixation defense: rotate any existing session id to a fresh one.
    const existing = readSessionIdFromRequest(request) ?? "";
    const { sid, record } = await getSessionStore().rotate(existing, user.id);
    await setSessionCookies(sid, record.csrfToken);

    logSecurityEvent("auth_login_success", { route: "/api/auth/login", principal: user.id });
    return NextResponse.json({
      success: true,
      data: { user: toPublicUser(user), csrfToken: record.csrfToken },
    });
  } catch (err) {
    return safeErrorResponse(err, {
      route: "/api/auth/login",
      status: 500,
      code: "internal_error",
      clientMessage: "Login failed. Please try again.",
    });
  }
}
