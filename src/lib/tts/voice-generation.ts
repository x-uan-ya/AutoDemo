import path from "node:path";
import type { DemoJob, PlanScene } from "@/types";
import { getTtsProvider } from "./provider";
import { toTtsLanguage } from "./voices";
import {
  TtsError,
  type SceneAudio,
  type TtsLanguage,
  type TtsVoice,
  type VoiceOver,
} from "./types";

/**
 * Phase 6 voice generation service.
 *
 * Generates one audio file per storyboard scene from its narration, using the
 * configured TTS provider. Partial success is preserved: if one scene fails,
 * the others still produce audio, and the failed scene is marked so the UI can
 * offer a retry.
 *
 * Audio is written under public/voice/<jobId>/ as scene-001.mp3, scene-002.mp3,
 * ... so it is served statically.
 */

const VOICE_ROOT = path.join(process.cwd(), "public", "voice");

function nowIso(): string {
  return new Date().toISOString();
}

/** scene-001.mp3 style filename from a 1-based order. */
function sceneFileName(order: number): string {
  return `scene-${String(order).padStart(3, "0")}.mp3`;
}

/** Resolve and validate the language for a job, throwing on unsupported. */
export function resolveJobLanguage(job: DemoJob): TtsLanguage {
  const language = toTtsLanguage(job.settings.language);
  if (!language) {
    throw new TtsError(
      "unsupported_language",
      `Voice is only available in English and Mandarin right now (job is "${job.settings.language}").`
    );
  }
  return language;
}

/** Generate audio for a single scene, returning its metadata (never throws). */
async function generateSceneAudio(
  jobId: string,
  scene: PlanScene,
  language: TtsLanguage,
  voice: TtsVoice
): Promise<SceneAudio> {
  const provider = getTtsProvider();
  const outputPath = path.join(VOICE_ROOT, jobId, sceneFileName(scene.order));

  const base: Omit<SceneAudio, "status" | "audioPath" | "duration"> = {
    sceneId: scene.id,
    order: scene.order,
    language,
    voice,
    text: scene.narration,
    provider: provider.name,
    generatedAt: nowIso(),
  };

  try {
    const result = await provider.generateSpeech({
      text: scene.narration,
      language,
      voice,
      outputPath,
    });
    return {
      ...base,
      audioPath: result.audioPath,
      duration: result.duration,
      status: "ready",
    };
  } catch (err) {
    const message =
      err instanceof TtsError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      ...base,
      audioPath: null,
      duration: 0,
      status: "failed",
      error: message,
    };
  }
}

/**
 * Generate voice-over for every scene in the approved storyboard.
 * Returns a VoiceOver with per-scene results; status reflects partial success.
 */
export async function generateVoiceOver(
  job: DemoJob,
  voice: TtsVoice,
  onProgress?: (order: number, total: number) => void
): Promise<VoiceOver> {
  if (!job.plan || job.plan.status !== "approved") {
    throw new TtsError("config", "Approve the storyboard before generating voice.");
  }
  const language = resolveJobLanguage(job);

  const scenes = [...job.plan.scenes].sort((a, b) => a.order - b.order);
  const results: SceneAudio[] = [];
  for (const scene of scenes) {
    onProgress?.(scene.order, scenes.length);
    results.push(await generateSceneAudio(job.id, scene, language, voice));
  }

  const anyFailed = results.some((s) => s.status === "failed");
  const allFailed = results.every((s) => s.status === "failed");

  return {
    language,
    voice,
    provider: getTtsProvider().name,
    // Not "ready" unless at least one scene succeeded; failed if all failed.
    status: allFailed ? "voice_failed" : anyFailed ? "voice_ready" : "voice_ready",
    scenes: results,
    generatedAt: nowIso(),
  };
}

/**
 * Regenerate the audio for a single scene, preserving the rest. Returns the
 * updated SceneAudio. Throws only on config/validation problems; generation
 * failures are captured in the returned metadata.
 */
export async function regenerateSceneVoice(
  job: DemoJob,
  sceneId: string,
  voice: TtsVoice
): Promise<SceneAudio> {
  if (!job.plan || job.plan.status !== "approved") {
    throw new TtsError("config", "Approve the storyboard before generating voice.");
  }
  const language = resolveJobLanguage(job);
  const scene = job.plan.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    throw new TtsError("config", "Scene not found in the storyboard.");
  }
  return generateSceneAudio(job.id, scene, language, voice);
}

export { TtsError };
