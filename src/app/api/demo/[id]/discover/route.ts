import { NextResponse } from "next/server";
import { exploreWebsite } from "@/lib/browser/browser-explorer";
import { ExplorerError } from "@/lib/browser/types";
import { discoverFeaturesFromExploration, AiError } from "@/lib/ai/feature-discovery";
import { getRepository } from "@/lib/repository";
import { labelFor, PURPOSE_OPTIONS } from "@/lib/options";

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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const repo = getRepository();
  const job = await repo.getById(id);
  if (!job) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "Demo not found." } },
      { status: 404 }
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
    console.error("Unexpected /discover error:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "internal_error",
          message: "An unexpected error occurred during feature discovery.",
        },
      },
      { status: 500 }
    );
  }
}
