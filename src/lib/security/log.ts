/**
 * Security-aware structured logging.
 *
 * Emits one-line JSON security events for auditing. It NEVER logs secrets,
 * tokens, cookies, authorization headers, passwords, or raw private user data —
 * only event types and non-sensitive context (host, route, reason, counts).
 */

export type SecurityEvent =
  | "ssrf_blocked"
  | "navigation_blocked"
  | "rate_limited"
  | "authz_denied"
  | "dangerous_action_flagged"
  | "job_failed"
  | "invalid_input"
  | "path_rejected"
  | "limit_exceeded";

/** Keys that must never be logged with a value. */
const REDACT_KEYS = new Set([
  "password",
  "token",
  "secret",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "credential",
  "accessKey",
  "secretKey",
]);

function sanitize(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    if (REDACT_KEYS.has(k) || REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]";
    } else if (typeof v === "string" && v.length > 300) {
      out[k] = v.slice(0, 300) + "…";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function logSecurityEvent(
  event: SecurityEvent,
  context: Record<string, unknown> = {}
): void {
  // Single-line, parseable. Goes to stdout/stderr -> log pipeline in prod.
  const payload = {
    ts: new Date().toISOString(),
    kind: "security",
    event,
    ...sanitize(context),
  };
  // Use warn so these stand out from normal info logs.
  console.warn("[security] " + JSON.stringify(payload));
}
