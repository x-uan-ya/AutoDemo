import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { generateLanguageVersion } from "@/lib/i18n/multilingual-generation";
import { isSupportedLanguageCode } from "@/lib/i18n/demo-language";
import type { TtsVoice } from "@/lib/tts/types";
import { guardDemoRoute } from "@/lib/security/route-guard";
import { acquireJobSlot } from "@/lib/security/limits";

/**
 * POST /api/demo/[id]/language/[code]
 *
 * Phase 8 — generate the demo in a specific language (en | zh-CN).
 *
 * Guards:
 *   - language code must be supported
 *   - storyboard must be approved
 *   - a completed browser recording must exist (reused across languages)
 *   - no duplicate active generation for the same (job, language)
 *
 * Flow: translate master narration -> per-scene TTS -> captions -> render a
 * separate demo-<code>.mp4 that REUSES the existing recording.
 *
 * Node runtime (Remotion + TTS + FS); may take a while.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; code: string }> }
) {
  const { id, code } = await params;

  if (!isSupportedLanguageCode(code)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "unsupported_language",
          message: "Only English (en) and Mandarin (zh-CN) are supported.",
        },
      },
      { status: 400 }
    );
  }

  const repo = getRepository();

  // Rate limit + authorization boundary.
  const guard = await guardDemoRoute(request, id, "language", "/api/demo/[id]/language");
  if (guard.response) return guard.response;
  const job = guard.job!;

  // Guard: approved storyboard.
  if (!job.plan || job.plan.status !== "approved" || job.plan.scenes.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "storyboard_missing", message: "An approved storyboard is required." },
      },
      { status: 409 }
    );
  }

  // Guard: a completed recording exists (reused across languages, never re-run).
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

  // Guard: reject duplicate active generation for this language.
  const claimed = await repo.tryStartLanguage(id, code);
  if (!claimed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "already_generating",
          message: `A ${code} demo is already being generated.`,
        },
      },
      { status: 409 }
    );
  }

  // Global concurrency gate (translate + voice + render is heavy).
  const releaseSlot = await acquireJobSlot();
  if (!releaseSlot) {
    await repo.upsertLanguageVersion(id, failedLanguageVersion(code, job));
    return NextResponse.json(
      {
        success: false,
        error: { code: "server_busy", message: "The server is busy. Please try again shortly." },
      },
      { status: 503 }
    );
  }

  try {
    const voice = job.settings.voice as TtsVoice;
    const version = await generateLanguageVersion(job, code, voice);
    await repo.upsertLanguageVersion(id, version);
    return NextResponse.json({
      success: version.status === "ready",
      language: version.language,
      status: version.status,
      videoPath: version.videoPath,
      videoDuration: version.videoDuration,
      reusedRecording: version.reusedRecording,
      error: version.error,
    });
  } catch (err) {
    // Record a failed version (generic) and log detail server-side only.
    console.error("[error:/api/demo/[id]/language]", err instanceof Error ? err.stack : err);
    await repo.upsertLanguageVersion(id, failedLanguageVersion(code, job));
    return NextResponse.json(
      {
        success: false,
        status: "failed",
        error: { code: "generation_failed", message: "Language generation failed. Please try again." },
      },
      { status: 500 }
    );
  } finally {
    await releaseSlot();
  }
}

/** A failed LanguageVersion with no internal detail leaked. */
function failedLanguageVersion(
  code: "en" | "zh-CN",
  job: { recording?: { success: boolean } }
) {
  return {
    language: code,
    scenes: [],
    videoPath: null,
    videoDuration: 0,
    status: "failed" as const,
    reusedRecording: !!job.recording?.success,
    error: "Language generation failed.",
    provider: "-",
    generatedAt: new Date().toISOString(),
  };
}
