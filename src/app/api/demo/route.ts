import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { authenticate } from "@/lib/auth/session";
import { verifyCsrf } from "@/lib/auth/csrf";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { validatePublicUrl, UrlSecurityError } from "@/lib/security/url-validator";
import { MAX_URL_LENGTH } from "@/lib/security/limits";
import { safeErrorResponse } from "@/lib/security/errors";
import { logSecurityEvent } from "@/lib/security/log";
import type { DemoSettings } from "@/types";

/**
 * POST /api/demo
 *
 * Create a new demo job owned by the authenticated user, from the create-form
 * settings. Returns the new demo id so the client can navigate to its detail
 * page, where the explore -> discover -> plan -> actions -> record pipeline
 * runs. This is the entry point that turns "Generate Demo" into a real job.
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  websiteUrl: z.string().min(1).max(MAX_URL_LENGTH),
  purpose: z.enum([
    "product_overview",
    "hackathon_demo",
    "customer_tutorial",
    "portfolio_demo",
    "sales_demo",
  ]),
  audience: z.string().max(300).optional().default(""),
  duration: z.enum(["30s", "60s", "90s", "120s"]),
  language: z.enum(["english", "mandarin", "malay", "japanese", "korean"]),
  voice: z.enum([
    "professional_female",
    "professional_male",
    "friendly_female",
    "friendly_male",
  ]),
  additionalInstructions: z.string().max(2000).optional().default(""),
});

function badRequest(message: string, code = "invalid_request") {
  return NextResponse.json(
    { success: false, error: { code, message } },
    { status: 400 }
  );
}

export async function POST(request: Request) {
  // Rate limit (reuse the explore bucket — creation is cheap but gates the
  // expensive pipeline).
  const limited = await enforceRateLimit(request, "explore", "/api/demo");
  if (limited) return limited;

  // Authentication: a demo is owned by a user.
  const auth = await authenticate(request);
  if (!auth) {
    logSecurityEvent("authz_denied", { route: "/api/demo", reason: "unauthenticated" });
    return NextResponse.json(
      { success: false, error: { code: "unauthenticated", message: "You must be signed in to do that." } },
      { status: 401 }
    );
  }

  // CSRF: state-changing POST.
  if (!verifyCsrf(request, auth.session)) {
    logSecurityEvent("authz_denied", { route: "/api/demo", reason: "csrf", principal: auth.user.id });
    return NextResponse.json(
      { success: false, error: { code: "csrf_failed", message: "Invalid or missing CSRF token." } },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be JSON.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return badRequest(parsed.error.issues[0]?.message ?? "Invalid request.");
  }

  // SSRF validation of the URL (same central validator the explorer uses).
  // We normalize but do not open the site here — that happens in the pipeline.
  let normalizedUrl: string;
  try {
    const validated = await validatePublicUrl(parsed.data.websiteUrl);
    normalizedUrl = validated.url;
  } catch (err) {
    if (err instanceof UrlSecurityError) {
      if (err.code === "blocked_host" || err.code === "private_address") {
        logSecurityEvent("ssrf_blocked", { route: "/api/demo", reason: err.message });
      }
      return badRequest(err.message, "invalid_url");
    }
    return safeErrorResponse(err, {
      route: "/api/demo",
      status: 500,
      code: "internal_error",
      clientMessage: "Could not create the demo. Please try again.",
    });
  }

  const settings: DemoSettings = {
    websiteUrl: normalizedUrl,
    purpose: parsed.data.purpose,
    audience: parsed.data.audience,
    duration: parsed.data.duration,
    language: parsed.data.language,
    voice: parsed.data.voice,
    additionalInstructions: parsed.data.additionalInstructions,
  };

  try {
    const job = await getRepository().create(auth.user.id, settings);
    return NextResponse.json(
      { success: true, data: { id: job.id } },
      { status: 201 }
    );
  } catch (err) {
    return safeErrorResponse(err, {
      route: "/api/demo",
      status: 500,
      code: "internal_error",
      clientMessage: "Could not create the demo. Please try again.",
    });
  }
}
