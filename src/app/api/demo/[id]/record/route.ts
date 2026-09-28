import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { recordDemo } from "@/lib/browser/recorder";

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
    // Any unexpected error still releases the recording slot and marks failure.
    const message = err instanceof Error ? err.message : String(err);
    await repo.finishRecording(id, {
      success: false,
      videoPath: null,
      duration: 0,
      scenes: [],
      screenshots: [],
      errors: [
        {
          sceneId: "-",
          action: "record",
          message: `Recording failed: ${message}`,
          timestamp: new Date().toISOString(),
        },
      ],
      recordedAt: new Date().toISOString(),
      viewport: { width: 0, height: 0 },
    });

    return NextResponse.json(
      {
        success: false,
        status: "RECORDING_FAILED",
        error: { code: "recording_failed", message },
      },
      { status: 500 }
    );
  }
}
