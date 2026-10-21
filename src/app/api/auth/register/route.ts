import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserStore, isValidEmail, UserExistsError, toPublicUser } from "@/lib/auth/user-store";
import { validatePasswordStrength, MAX_PASSWORD_LENGTH } from "@/lib/auth/password";
import { getSessionStore } from "@/lib/auth/session-store";
import { setSessionCookies } from "@/lib/auth/cookies";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { safeErrorResponse } from "@/lib/security/errors";
import { logSecurityEvent } from "@/lib/security/log";

/**
 * POST /api/auth/register
 *
 * Creates an account, then logs the user in by establishing a fresh session.
 * Body: { email, password }. Never logs the password. Rate limited to blunt
 * automated signup abuse.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  email: z.string().min(1).max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

function badRequest(message: string) {
  return NextResponse.json(
    { success: false, error: { code: "invalid_request", message } },
    { status: 400 }
  );
}

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, "register", "/api/auth/register");
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return badRequest("Email and password are required.");

  const { email, password } = parsed.data;
  if (!isValidEmail(email)) return badRequest("Enter a valid email address.");

  const strength = validatePasswordStrength(password);
  if (strength) return badRequest(strength);

  try {
    const user = await getUserStore().create(email, password);
    // Establish a session immediately (registration logs you in).
    const { sid, record } = await getSessionStore().create(user.id);
    await setSessionCookies(sid, record.csrfToken);

    logSecurityEvent("auth_registered", { route: "/api/auth/register", principal: user.id });
    return NextResponse.json(
      { success: true, data: { user: toPublicUser(user), csrfToken: record.csrfToken } },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof UserExistsError) {
      // Do not confirm which emails exist via a distinct error — but for
      // registration a generic conflict is standard and acceptable.
      return NextResponse.json(
        { success: false, error: { code: "email_taken", message: "Unable to register with those details." } },
        { status: 409 }
      );
    }
    return safeErrorResponse(err, {
      route: "/api/auth/register",
      status: 500,
      code: "internal_error",
      clientMessage: "Registration failed. Please try again.",
    });
  }
}
