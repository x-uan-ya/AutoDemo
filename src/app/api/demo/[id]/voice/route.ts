import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/repository";
import {
  generateVoiceOver,
  regenerateSceneVoice,
} from "@/lib/tts/voice-generation";
import { TtsError, type TtsVoice } from "@/lib/tts/types";
import { toTtsLanguage } from "@/lib/tts/voices";

/**
 * /api/demo/[id]/voice
 *
 * POST  — generate narration audio for every storyboard scene.
 * PATCH — regenerate one scene's audio (body: { sceneId }).
 *
 * Guards: storyboard must be approved; the job's language must be supported
 * (English or Mandarin); the voice must be one of the four allowed voices.
 *
 * Audio is NOT merged with the recording — that is a later phase.
 * Node runtime (AWS SDK + filesystem); can take a while for many scenes.
 */
export const runtime = "nodejs";
export const maxDuration = 180;

const VOICE_VALUES = [
  "professional_female",
  "professional_male",
  "friendly_female",
  "friendly_male",
] as const;

/** Optional voice override; defaults to the job's configured voice. */
const postSchema = z
  .object({ voice: z.enum(VOICE_VALUES).optional() })
  .optional();

function validateReady(
  job: {
    plan?: { status: string } | undefined;
    settings: { language: string; voice: string };
  }
): { code: string; message: string; status: number } | null {
  if (!job.plan || job.plan.status !== "approved") {
    return {
      code: "storyboard_not_approved",
      message: "Approve the storyboard before generating voice.",
      status: 409,
    };
  }
  if (!toTtsLanguage(job.settings.language as never)) {
    return {
      code: "unsupported_language",
      message:
        "Voice is only available in English and Mandarin right now.",
      status: 400,
    };
  }
  return null;
}

export async function POST(
  request: Request,
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

  const ready = validateReady(job);
  if (ready) {
    return NextResponse.json(
      { success: false, error: { code: ready.code, message: ready.message } },
      { status: ready.status }
    );
  }

  // Optional voice override.
  let voice: TtsVoice = job.settings.voice as TtsVoice;
  try {
    const text = await request.text();
    if (text.trim()) {
      const parsed = postSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        return NextResponse.json(
          { success: false, error: { code: "invalid_request", message: "Invalid voice." } },
          { status: 400 }
        );
      }
      if (parsed.data?.voice) voice = parsed.data.voice;
    }
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "invalid_request", message: "Body must be JSON." } },
      { status: 400 }
    );
  }

  // Duplicate-job guard (atomic claim).
  const claimed = await repo.tryStartVoice(id);
  if (!claimed) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "already_generating",
          message: "Voice generation is already in progress for this demo.",
        },
      },
      { status: 409 }
    );
  }

  try {
    const voiceOver = await generateVoiceOver(job, voice);
    await repo.finishVoiceOver(id, voiceOver);
    return NextResponse.json({
      success: voiceOver.status !== "voice_failed",
      status:
        voiceOver.status === "voice_failed" ? "VOICE_FAILED" : "VOICE_READY",
      voiceOver,
    });
  } catch (err) {
    // Release the slot and report failure without pretending success.
    await repo.finishVoiceOver(id, {
      language: (toTtsLanguage(job.settings.language as never) ?? "english"),
      voice,
      provider: "-",
      status: "voice_failed",
      scenes: [],
      generatedAt: new Date().toISOString(),
    });
    if (err instanceof TtsError) {
      return NextResponse.json(
        { success: false, status: "VOICE_FAILED", error: { code: err.code, message: err.message } },
        { status: err.code === "config" || err.code === "unsupported_language" ? 400 : 502 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("Unexpected /voice error:", err);
    return NextResponse.json(
      { success: false, status: "VOICE_FAILED", error: { code: "internal_error", message } },
      { status: 500 }
    );
  }
}

const patchSchema = z.object({
  sceneId: z.string().min(1),
  voice: z.enum(VOICE_VALUES).optional(),
});

export async function PATCH(
  request: Request,
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

  const ready = validateReady(job);
  if (ready) {
    return NextResponse.json(
      { success: false, error: { code: ready.code, message: ready.message } },
      { status: ready.status }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "invalid_request", message: "Body must be JSON." } },
      { status: 400 }
    );
  }
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid request." },
      },
      { status: 400 }
    );
  }

  const voice: TtsVoice =
    parsed.data.voice ?? (job.voiceOver?.voice ?? (job.settings.voice as TtsVoice));

  try {
    const audio = await regenerateSceneVoice(job, parsed.data.sceneId, voice);
    const updated = await repo.updateSceneAudio(id, audio);
    if (!updated) {
      return NextResponse.json(
        { success: false, error: { code: "not_found", message: "No voice-over or scene to update." } },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: audio.status === "ready",
      voiceOver: updated.voiceOver,
      scene: audio,
    });
  } catch (err) {
    if (err instanceof TtsError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: err.code === "config" || err.code === "unsupported_language" ? 400 : 502 }
      );
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: { code: "internal_error", message } },
      { status: 500 }
    );
  }
}
