import { NextResponse } from "next/server";
import { exploreWebsite } from "@/lib/browser/browser-explorer";
import { ExplorerError } from "@/lib/browser/types";
import { discoverFeaturesFromExploration, AiError } from "@/lib/ai/feature-discovery";
import { getRepository } from "@/lib/repository";
import { labelFor, PURPOSE_OPTIONS } from "@/lib/options";
import { guardDemoRoute } from "@/lib/security/route-guard";
import { acquireJobSlot } from "@/lib/security/limits";
import { safeErrorResponse } from "@/lib/security/errors";
import { logSecurityEvent } from "@/lib/security/log";

/**
 * POST /api/demo/[id]/discover
 *
 * Runs the Feature Discovery stage for an existing demo job:
 *   1. Explores the job's website with Playwright (passive).
 *   2. Sends the page data + screenshots to the multimodal AI provider.
 *   3. Persists the validated features + AI usage metadata on the job.
 *
 * Response: { success: true, data: { features, meta } }
 *        or { success: false, error: { code, message } }
 *
 * Needs the Node runtime (Playwright + AWS SDK) and can take tens of seconds.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = getRepository();

  // Rate limit (explore bucket — this runs the browser) + authorization.
  const guard = await guardDemoRoute(request, id, "explore", "/api/demo/[id]/discover");
  if (guard.response) return guard.response;
  const job = guard.job!;

  const releaseSlot = acquireJobSlot();
  if (!releaseSlot) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "server_busy", message: "The server is busy. Please try again shortly." },
      },
      { status: 503 }
    );
  }

  try {
    // 1. Explore (passive).
    const exploration = await exploreWebsite(job.settings.websiteUrl);

    // 2. Discover features from the exploration + screenshots.
    const { features, meta } = await discoverFeaturesFromExploration(
      exploration,
      {
        purpose: labelFor(PURPOSE_OPTIONS, job.settings.purpose),
        audience: job.settings.audience,
      }
    );

    // 3. Persist.
    const updated = await repo.setFeatures(id, features, meta);

    return NextResponse.json({
      success: true,
      data: { features: updated?.features ?? features, meta },
    });
  } catch (err) {
    if (err instanceof ExplorerError) {
      if (err.code === "blocked_url") {
        logSecurityEvent("ssrf_blocked", { route: "/api/demo/[id]/discover", reason: err.message });
      }
      const status =
        err.code === "timeout"
          ? 504
          : err.code === "invalid_url" || err.code === "blocked_url"
            ? 400
            : 502;
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status }
      );
    }
    if (err instanceof AiError) {
      const status = err.code === "config" ? 500 : 502;
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status }
      );
    }
    return safeErrorResponse(err, {
      route: "/api/demo/[id]/discover",
      status: 500,
      code: "internal_error",
      clientMessage: "An unexpected error occurred during feature discovery.",
    });
  } finally {
    releaseSlot();
  }
}
