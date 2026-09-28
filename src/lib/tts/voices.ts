import type { DemoLanguage } from "@/types";
import type { TtsLanguage, TtsVoice } from "./types";

/**
 * Voice + language mapping for TTS.
 *
 * The UI only ever sees the app's own voice keys (Professional Female, etc.)
 * and language keys (english, mandarin). This module maps those to concrete
 * provider voice ids. Keeping the mapping here means provider-specific ids
 * never leak into the UI or the rest of the app, and adding a language is a
 * matter of extending these tables.
 */

/** Languages the TTS layer supports today. */
export const SUPPORTED_TTS_LANGUAGES: TtsLanguage[] = ["english", "mandarin"];

/** BCP-47-ish language codes per supported language (for providers/logging). */
export const LANGUAGE_CODES: Record<TtsLanguage, string> = {
  english: "en-US",
  mandarin: "cmn-CN",
};

/** Narrow a DemoLanguage to a supported TtsLanguage, or null. */
export function toTtsLanguage(language: DemoLanguage): TtsLanguage | null {
  return SUPPORTED_TTS_LANGUAGES.includes(language as TtsLanguage)
    ? (language as TtsLanguage)
    : null;
}

/**
 * Amazon Polly voice ids by (language, app voice). Polly's neural voices are
 * chosen for tone: professional vs friendly is approximated by voice choice.
 * These ids are provider-specific and MUST NOT be exposed to the UI.
 *
 * English (en-US): Joanna/Danielle (F), Matthew/Stephen (M).
 * Mandarin (cmn-CN): Zhiyu (F). Polly currently offers Zhiyu for Mandarin;
 * male Mandarin falls back to Zhiyu with a note (kept mapped so the app works).
 */
export const POLLY_VOICE_IDS: Record<
  TtsLanguage,
  Record<TtsVoice, string>
> = {
  english: {
    professional_female: "Joanna",
    professional_male: "Matthew",
    friendly_female: "Danielle",
    friendly_male: "Stephen",
  },
  mandarin: {
    professional_female: "Zhiyu",
    professional_male: "Zhiyu",
    friendly_female: "Zhiyu",
    friendly_male: "Zhiyu",
  },
};

/** Polly engine per voice id (neural where available). */
export function pollyEngineFor(voiceId: string): "neural" | "standard" {
  // All the ids above support neural; default to neural.
  const neural = new Set([
    "Joanna",
    "Matthew",
    "Danielle",
    "Stephen",
    "Zhiyu",
  ]);
  return neural.has(voiceId) ? "neural" : "standard";
}

export function pollyVoiceId(
  language: TtsLanguage,
  voice: TtsVoice
): string | null {
  return POLLY_VOICE_IDS[language]?.[voice] ?? null;
}
