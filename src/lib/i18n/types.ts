import type { DemoLanguageCode } from "./demo-language";
import type { Caption, VideoConfig } from "@/video/types";

/**
 * Phase 8 — multilingual data model.
 *
 * The English storyboard narration remains the MASTER script and is never
 * overwritten (it lives on `plan.scenes[].narration`). Each generated language
 * produces a `LanguageVersion` holding the translated narration, its audio, and
 * captions per scene, plus a per-language rendered video. Adding a language
 * adds another `LanguageVersion` — the master is untouched.
 */

/** Per-scene localized content for one language. */
export interface LanguageSceneVersion {
  sceneId: string;
  order: number;
  /** Translated (or master, for English) narration for this scene. */
  narration: string;
  /** Public path to this language's audio for the scene, or null. */
  audioPath: string | null;
  /** Audio duration in seconds (0 when unavailable). */
  duration: number;
  /** Captions generated from THIS language's narration. */
  captions: Caption[];
}

export type LanguageVersionStatus =
  | "translating"
  | "voicing"
  | "rendering"
  | "ready"
  | "failed";

/** One language's full version of the demo. */
export interface LanguageVersion {
  language: DemoLanguageCode;
  /** Per-scene localized narration + audio + captions. */
  scenes: LanguageSceneVersion[];
  /** Public path to this language's rendered MP4 (demo-<code>.mp4), or null. */
  videoPath: string | null;
  /** Rendered video duration in seconds. */
  videoDuration: number;
  videoConfig?: VideoConfig;
  status: LanguageVersionStatus;
  /** Whether this language reused an existing browser recording. */
  reusedRecording: boolean;
  error?: string;
  provider: string;
  generatedAt: string;
}

/**
 * The multilingual container stored on a job. `masterNarration` snapshots the
 * source (English) narration per scene at generation time, so it is clear what
 * every translation was derived from even if the storyboard changes later.
 */
export interface Multilingual {
  masterLanguage: DemoLanguageCode;
  masterNarration: { sceneId: string; order: number; narration: string }[];
  languageVersions: LanguageVersion[];
}
