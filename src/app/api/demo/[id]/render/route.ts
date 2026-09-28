import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { renderDemoVideo, RenderError } from "@/lib/video/render";

/**
 * POST /api/demo/[id]/render
 *
 * Phase 7 — combine the browser recording, scene narration, timing, and
 * captions into a polished MP4 via Remotion.
 *
 * Guards:
 *   - storyboard must exist and be approved
 *   - a browser recording must exist
 *   - voice narration must exist
 *   - no duplicate active render for the same job
 *
 * Node runtime (Remotion bundler/renderer + filesystem); rendering is slow, so
 * a generous maxDuration is set.
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
  if (!job.plan || job.plan.status !== "approved" || job.plan.scenes.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "storyboard_missing", message: "An approved storyboard is required." },
      },
      { status: 409 }
    );
  }

  // Guard: browser recording exists (Phase 5).
  if (!job.recording || !job.recording.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "recording_missing",
          message: "A completed browser recording is required. Generate the recording first.",
        },
      },
      { status: 409 }
    );
  }

  // Guard: voice exists (Phase 6) with at least one ready scene.
  const hasVoice =
    job.voiceOver && job.voiceOver.scenes.some((s) => s.status === "ready");
  if (!hasVoice) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "voice_missing",
          message: "Scene narration audio is required. Generate the voice first.",
        },
      },
      { status: 409 }
    );
  }

  // Guard: reject duplicate active render jobs (atomic claim).
  const claimed = await repo.tryStartRender(id);
  if (!claimed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "already_rendering",
          message: "A render is already in progress for this demo.",
        },
      },
      { status: 409 }
    );
  }

  try {
    const render = await renderDemoVideo(job);
    await repo.finishRender(id, render);
    return NextResponse.json({
      success: render.status === "render_complete",
      status: render.status === "render_complete" ? "RENDER_COMPLETE" : "RENDER_FAILED",
      videoPath: render.videoPath,
      duration: render.duration,
      config: render.config,
      sceneCount: render.sceneCount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Store a failed result (and release the slot) — never pretend success.
    await repo.finishRender(id, {
      status: "render_failed",
      videoPath: null,
      duration: 0,
      config: { width: 1920, height: 1080, fps: 30 },
      sceneCount: job.plan.scenes.length,
      error: message,
      renderedAt: new Date().toISOString(),
    });

    const status = err instanceof RenderError && err.code === "config" ? 400 : 500;
    return NextResponse.json(
      { success: false, status: "RENDER_FAILED", error: { code: "render_failed", message } },
      { status }
    );
  }
}
