import type { DemoLanguage } from "@/types";
import type { TtsLanguage } from "@/lib/tts/types";

/**
 * Phase 8 — demo language model.
 *
 * Central registry of the languages a demo can be generated in. Adding a new
 * language later is a matter of adding one entry here (plus a TTS voice mapping
 * in tts/voices.ts). Nothing else in the multilingual pipeline hard-codes a
 * language, so this table is the single source of truth.
 *
 * Initially: English (en) and Mandarin Chinese (zh-CN).
 */

/** Stable language codes used across the multilingual layer + filenames. */
export type DemoLanguageCode = "en" | "zh-CN";

export interface DemoLanguageDef {
  /** Stable code, e.g. "en" or "zh-CN". Used in filenames (demo-en.mp4). */
  languageCode: DemoLanguageCode;
  /** Human-readable name shown in English UI. */
  displayName: string;
  /** Native name shown in the language selector (e.g. "中文"). */
  nativeName: string;
  /** BCP-47 locale, e.g. "en-US" / "zh-CN". */
  locale: string;
  /** The app's TTS language key this maps to. */
  ttsLanguage: TtsLanguage;
  /** Language captions are written in (same code; separated for clarity). */
  captionLanguage: DemoLanguageCode;
  /** The app's DemoLanguage union value (bridges legacy settings). */
  demoLanguage: DemoLanguage;
}

export const DEMO_LANGUAGES: Record<DemoLanguageCode, DemoLanguageDef> = {
  en: {
    languageCode: "en",
    displayName: "English",
    nativeName: "English",
    locale: "en-US",
    ttsLanguage: "english",
    captionLanguage: "en",
    demoLanguage: "english",
  },
  "zh-CN": {
    languageCode: "zh-CN",
    displayName: "Mandarin Chinese",
    nativeName: "中文",
    locale: "zh-CN",
    ttsLanguage: "mandarin",
    captionLanguage: "zh-CN",
    demoLanguage: "mandarin",
  },
};

/** Ordered list of supported languages for UI rendering. */
export const SUPPORTED_DEMO_LANGUAGES: DemoLanguageDef[] = [
  DEMO_LANGUAGES.en,
  DEMO_LANGUAGES["zh-CN"],
];

export function isSupportedLanguageCode(
  code: string
): code is DemoLanguageCode {
  return code === "en" || code === "zh-CN";
}

export function getLanguageDef(
  code: DemoLanguageCode
): DemoLanguageDef {
  return DEMO_LANGUAGES[code];
}

/** Map the app's DemoLanguage (e.g. "english") to a DemoLanguageCode. */
export function demoLanguageToCode(
  language: DemoLanguage
): DemoLanguageCode | null {
  if (language === "english") return "en";
  if (language === "mandarin") return "zh-CN";
  return null;
}

/** True when a language is the master-script language (English). */
export function isMasterLanguage(code: DemoLanguageCode): boolean {
  return code === "en";
}
