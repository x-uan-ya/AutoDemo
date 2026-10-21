import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/session";
import { toPublicUser } from "@/lib/auth/user-store";

/**
 * GET /api/auth/session
 *
 * Returns the current authenticated user and the session's CSRF token, or
 * { authenticated: false } when there is no valid session. Safe (read-only)
 * method; no CSRF needed. Used by the frontend to bootstrap auth state and to
 * obtain the CSRF token to echo on unsafe requests.
 */
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json({ success: true, data: { authenticated: false } });
  }
  return NextResponse.json({
    success: true,
    data: {
      authenticated: true,
      user: toPublicUser(auth.user),
      csrfToken: auth.session.csrfToken,
    },
  });
}
