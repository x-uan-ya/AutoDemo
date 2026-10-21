import { NextResponse } from "next/server";
import { getSessionStore } from "@/lib/auth/session-store";
import { clearSessionCookies } from "@/lib/auth/cookies";
import { authenticate } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { logSecurityEvent } from "@/lib/security/log";

/**
 * POST /api/auth/logout
 *
 * Invalidates the server-side session (so the session id can never be reused)
 * and clears the cookies. CSRF-protected because it is state-changing. Always
 * responds success-ish (idempotent): logging out when already logged out is OK.
 */
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authenticate(request);

  // If there is a valid session, require a valid CSRF token to destroy it.
  if (auth && !verifyCsrf(request, auth.session)) {
    return NextResponse.json(
      { success: false, error: { code: "csrf_failed", message: "Invalid or missing CSRF token." } },
      { status: 403 }
    );
  }

  if (auth) {
    await getSessionStore().destroy(auth.sid);
    logSecurityEvent("auth_logout", { route: "/api/auth/logout", principal: auth.user.id });
  }
  await clearSessionCookies();

  return NextResponse.json({ success: true });
}
