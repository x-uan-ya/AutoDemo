import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { recordDemo } from "@/lib/browser/recorder";
import { guardDemoRoute } from "@/lib/security/route-guard";
import { acquireJobSlot } from "@/lib/security/limits";
import { safeErrorResponse } from "@/lib/security/errors";

/**
 * POST /api/demo/[id]/record
 *
 * Phase 5 — deterministic browser recording.
 *
 * Guards:
 *   - storyboard must be approved
 *   - browser actions must be approved
 *   - no duplicate active recording for the same job
 *
 * On success: launches the recorder, executes the approved actions scene by
 * scene, stores the RecordingResult, and returns status + video path.
 *
 * Runs on the Node runtime (Playwright) and may take a while.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = getRepository();

  // Rate limit + authorization boundary.
  const guard = await guardDemoRoute(request, id, "record", "/api/demo/[id]/record");
  if (guard.response) return guard.response;
  const job = guard.job!;

  // Guard: storyboard approved.
  if (!job.plan || job.plan.status !== "approved") {
    return NextResponse.json(
      {
        success: false,
        error: { code: "storyboard_not_approved", message: "Approve the storyboard first." },
      },
      { status: 409 }
    );
  }

  // Guard: browser actions approved.
  if (!job.actionPlan || job.actionPlan.status !== "approved") {
    return NextResponse.json(
      {
        success: false,
        error: { code: "actions_not_approved", message: "Approve the browser actions first." },
      },
      { status: 409 }
    );
  }

  if (job.actionPlan.scenes.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "no_actions", message: "There are no browser actions to record." },
      },
      { status: 409 }
    );
  }

  // Guard: reject duplicate active recording jobs (atomic claim).
  const claimed = await repo.tryStartRecording(id);
  if (!claimed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "already_recording",
          message: "A recording is already in progress for this demo.",
        },
      },
      { status: 409 }
    );
  }

  // Global concurrency gate: cap simultaneous heavy browser jobs server-wide.
  const releaseSlot = acquireJobSlot();
  if (!releaseSlot) {
    await repo.finishRecording(id, failedRecording("Server is busy. Try again shortly."));
    return NextResponse.json(
      {
        success: false,
        error: { code: "server_busy", message: "The server is busy. Please try again shortly." },
      },
      { status: 503 }
    );
  }

  try {
    const result = await recordDemo({
      jobId: id,
      websiteUrl: job.settings.websiteUrl,
      scenes: job.actionPlan.scenes,
    });

    await repo.finishRecording(id, result);

    return NextResponse.json({
      success: result.success,
      status: result.success ? "RECORDING_COMPLETE" : "RECORDING_FAILED",
      videoPath: result.videoPath,
      duration: result.duration,
      scenes: result.scenes,
      errors: result.errors,
    });
  } catch (err) {
    // Store a failed result (server-side detail) but return a generic message.
    await repo.finishRecording(id, failedRecording("Recording failed."));
    return safeErrorResponse(err, {
      route: "/api/demo/[id]/record",
      status: 500,
      code: "recording_failed",
      clientMessage: "Recording failed. Please try again.",
    });
  } finally {
    // Always release the concurrency slot (browser cleanup is in the recorder).
    releaseSlot();
  }
}

/** Build a minimal failed RecordingResult (no internal detail leaked). */
function failedRecording(reason: string) {
  return {
    success: false,
    videoPath: null,
    duration: 0,
    scenes: [],
    screenshots: [],
    errors: [
      {
        sceneId: "-",
        action: "record",
        message: reason,
        timestamp: new Date().toISOString(),
      },
    ],
    recordedAt: new Date().toISOString(),
    viewport: { width: 0, height: 0 },
  };
}
