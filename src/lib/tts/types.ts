import type { DemoLanguage, DemoVoice } from "@/types";

/**
 * Phase 6 — Text-to-Speech types.
 *
 * The app talks to TTS only through the `TtsProvider` interface, so the
 * concrete provider (Amazon Polly, or an offline mock) can be swapped without
 * touching callers. Provider-specific voice ids never leak past the provider
 * boundary — callers pass the app's own `DemoVoice` / `DemoLanguage` values.
 */

/** Languages the TTS layer currently supports. A subset of DemoLanguage. */
export type TtsLanguage = Extract<DemoLanguage, "english" | "mandarin">;

/** Voice options exposed to the UI (mapped to provider voices internally). */
export type TtsVoice = DemoVoice;

/** Input to a single speech-generation call. */
export interface GenerateSpeechInput {
  /** The text to speak. */
  text: string;
  language: TtsLanguage;
  voice: TtsVoice;
  /**
   * Absolute path the audio should be written to (mp3). The provider writes
   * the file here and echoes it back in `audioPath` (as a public URL path).
   */
  outputPath: string;
}

/** Result of a single speech-generation call. */
export interface GenerateSpeechResult {
  /** Public URL path to the generated audio (served from /public). */
  audioPath: string;
  /** Duration of the audio in seconds. */
  duration: number;
}

/**
 * TTS provider contract. Implementations map (language, voice) to their own
 * voice catalog and synthesize `text` to an mp3 at `outputPath`.
 */
export interface TtsProvider {
  readonly name: string;
  generateSpeech(input: GenerateSpeechInput): Promise<GenerateSpeechResult>;
}

/** Categorized TTS errors so the API can map them to helpful messages. */
export type TtsErrorCode =
  | "config"
  | "unsupported_language"
  | "unsupported_voice"
  | "provider"
  | "empty_text";

export class TtsError extends Error {
  code: TtsErrorCode;
  constructor(code: TtsErrorCode, message: string) {
    super(message);
    this.name = "TtsError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Persisted metadata
// ---------------------------------------------------------------------------

export type SceneAudioStatus = "ready" | "failed";

/** Audio metadata stored per scene on the demo job. */
export interface SceneAudio {
  sceneId: string;
  /** 1-based scene order (for stable file naming: scene-001.mp3). */
  order: number;
  language: TtsLanguage;
  voice: TtsVoice;
  /** The narration text that was spoken. */
  text: string;
  /** Duration in seconds (0 when failed). */
  duration: number;
  /** Public URL path to the mp3, or null when generation failed. */
  audioPath: string | null;
  status: SceneAudioStatus;
  /** Error message when status is "failed". */
  error?: string;
  /** Provider that produced (or attempted) the audio. */
  provider: string;
  generatedAt: string;
}

export type VoiceStatus = "voice_generating" | "voice_ready" | "voice_failed";

/**
 * The full voice-over result for a demo: one SceneAudio per storyboard scene,
 * plus the settings used and an overall status. Partial success is preserved —
 * successfully generated scenes remain even if others failed.
 */
export interface VoiceOver {
  language: TtsLanguage;
  voice: TtsVoice;
  provider: string;
  status: VoiceStatus;
  scenes: SceneAudio[];
  generatedAt: string;
}
