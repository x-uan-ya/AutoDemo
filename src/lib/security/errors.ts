import { NextResponse } from "next/server";
import { logSecurityEvent } from "./log";

/**
 * Safe error responses.
 *
 * Production responses must NOT expose stack traces, env vars, secrets, DB
 * strings, internal filesystem paths, or server details. This helper logs the
 * real error server-side and returns a generic, stable client payload.
 */

export function safeErrorResponse(
  err: unknown,
  opts: { route: string; status?: number; code?: string; clientMessage?: string } = {
    route: "unknown",
  }
): NextResponse {
  const status = opts.status ?? 500;
  const code = opts.code ?? "internal_error";
  const clientMessage =
    opts.clientMessage ?? "An unexpected error occurred. Please try again.";

  // Detailed, server-only log (not returned to the client).
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[error:${opts.route}] ${detail}`);
  logSecurityEvent("job_failed", { route: opts.route, status, code });

  return NextResponse.json(
    { success: false, error: { code, message: clientMessage } },
    { status }
  );
}

/** A client-safe validation error (no internals). */
export function validationErrorResponse(
  message: string,
  code = "invalid_request"
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: 400 }
  );
}
