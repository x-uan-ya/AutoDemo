import path from "node:path";
import type { DemoJob, PlanScene } from "@/types";
import type {
  LanguageVersion,
  LanguageSceneVersion,
  Multilingual,
} from "./types";
import {
  getLanguageDef,
  isMasterLanguage,
  type DemoLanguageCode,
} from "./demo-language";
import { translateNarration } from "@/lib/ai/translation";
import { getTtsProvider } from "@/lib/tts/provider";
import type { TtsVoice } from "@/lib/tts/types";
import { buildCaptions } from "@/lib/video/timeline";
import { buildTimeline } from "@/lib/video/timeline";
import { renderDemoVideo } from "@/lib/video/render";

/**
 * Phase 8 multilingual generation orchestrator.
 *
 * For a target language it:
 *   1. Translates the MASTER (English) narration (English passes through).
 *   2. Generates TTS per scene in that language, stored separately under
 *      public/voice/<jobId>/<code>/.
 *   3. Builds captions from the translated narration.
 *   4. Renders a separate MP4 (demo-<code>.mp4) that REUSES the existing
 *      browser recording (screenshots) — the browser is never re-run just
 *      because the language changed.
 *
 * The master English storyboard narration is never overwritten.
 */

const VOICE_ROOT = path.join(process.cwd(), "public", "voice");

function nowIso(): string {
  return new Date().toISOString();
}

function sceneFileName(order: number): string {
  return `scene-${String(order).padStart(3, "0")}.mp3`;
}

/** Snapshot the master narration for storage/provenance. */
export function buildMasterNarration(scenes: PlanScene[]) {
  return [...scenes]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ sceneId: s.id, order: s.order, narration: s.narration }));
}

export interface GenerateLanguageResult {
  version: LanguageVersion;
}

/**
 * Generate (or regenerate) a single language version end to end.
 * `voice` defaults to the job's configured voice.
 */
export async function generateLanguageVersion(
  job: DemoJob,
  language: DemoLanguageCode,
  voice: TtsVoice
): Promise<LanguageVersion> {
  const def = getLanguageDef(language);
  const scenes = [...(job.plan?.scenes ?? [])].sort((a, b) => a.order - b.order);

  const base: LanguageVersion = {
    language,
    scenes: [],
    videoPath: null,
    videoDuration: 0,
    status: "translating",
    reusedRecording: !!job.recording?.success,
    provider: "-",
    generatedAt: nowIso(),
  };

  if (scenes.length === 0) {
    return { ...base, status: "failed", error: "No storyboard scenes to localize." };
  }

  // 1. Translate the master narration (English passes through unchanged).
  let translations: string[];
  let translationProvider = "passthrough";
  try {
    const result = await translateNarration({
      texts: scenes.map((s) => s.narration),
      target: language,
    });
    translations = result.texts;
    translationProvider = result.provider;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, status: "failed", error: `Translation failed: ${message}` };
  }

  // 2 + 3. TTS per scene (stored under the language subfolder) + captions.
  const tts = getTtsProvider();
  const localizedScenes: LanguageSceneVersion[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const narration = translations[i] ?? scene.narration;
    const outputPath = path.join(
      VOICE_ROOT,
      job.id,
      language,
      sceneFileName(scene.order)
    );

    let audioPath: string | null = null;
    let duration = 0;
    try {
      const speech = await tts.generateSpeech({
        text: narration,
        language: def.ttsLanguage,
        voice,
        outputPath,
      });
      audioPath = speech.audioPath;
      duration = speech.duration;
    } catch {
      // Leave audio null for this scene; captions/render still proceed.
      audioPath = null;
      duration = 0;
    }

    localizedScenes.push({
      sceneId: scene.id,
      order: scene.order,
      narration,
      audioPath,
      duration,
      captions: buildCaptions(narration, Math.max(2.5, duration)),
    });
  }

  // 4. Render a per-language video that reuses the recording.
  const props = buildTimeline(job, {
    showCursor: false,
    includeTitleCard: true,
    includeEndCard: true,
    titleSubtitle: def.displayName,
    languageScenes: Object.fromEntries(
      localizedScenes.map((s) => [
        s.sceneId,
        { narration: s.narration, audioPath: s.audioPath, duration: s.duration },
      ])
    ),
  });

  try {
    const render = await renderDemoVideo(job, {
      props,
      outputFileName: `demo-${language}.mp4`,
    });
    return {
      language,
      scenes: localizedScenes,
      videoPath: render.videoPath,
      videoDuration: render.duration,
      videoConfig: render.config,
      status: "ready",
      reusedRecording: !!job.recording?.success,
      provider: translationProvider,
      generatedAt: nowIso(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      language,
      scenes: localizedScenes,
      videoPath: null,
      videoDuration: 0,
      status: "failed",
      reusedRecording: !!job.recording?.success,
      error: `Render failed: ${message}`,
      provider: translationProvider,
      generatedAt: nowIso(),
    };
  }
}

/** Create the multilingual container seeded with the master narration. */
export function initMultilingual(job: DemoJob): Multilingual {
  return {
    masterLanguage: "en",
    masterNarration: buildMasterNarration(job.plan?.scenes ?? []),
    languageVersions: [],
  };
}

export { isMasterLanguage };
