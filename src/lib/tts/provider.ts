import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  TtsProvider,
  GenerateSpeechInput,
  GenerateSpeechResult,
} from "./types";
import { TtsError } from "./types";
import {
  LANGUAGE_CODES,
  pollyEngineFor,
  pollyVoiceId,
  toTtsLanguage,
} from "./voices";

/**
 * TTS provider adapter + selection.
 *
 * The rest of the app depends only on the `TtsProvider` interface. Two
 * implementations ship:
 *   - PollyTtsProvider: Amazon Polly (used when AWS is configured or
 *     AUTODEMO_TTS_PROVIDER=polly). Maps app voices to Polly voice ids.
 *   - MockTtsProvider: writes a valid silent MP3 offline, so the app and its
 *     audio players work with zero cloud setup.
 *
 * Provider-specific voice ids never leave this module boundary.
 */

/** Average speaking rate for estimating audio duration from text. */
const WORDS_PER_SECOND = 2.5;
/** For CJK (Mandarin), estimate by characters instead of whitespace words. */
const CJK_CHARS_PER_SECOND = 4.5;

function estimateDurationSeconds(text: string, language: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  if (language === "mandarin") {
    const chars = trimmed.replace(/\s+/g, "").length;
    return Math.max(1, Math.round(chars / CJK_CHARS_PER_SECOND));
  }
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_SECOND));
}

/** Public URL path for a file written under /public. */
function publicPath(absPath: string): string {
  const rel = path.relative(path.join(process.cwd(), "public"), absPath);
  return "/" + rel.split(path.sep).join("/");
}

// ---------------------------------------------------------------------------
// Amazon Polly provider
// ---------------------------------------------------------------------------

class PollyTtsProvider implements TtsProvider {
  readonly name = "polly";
  private readonly region: string;

  constructor(region: string) {
    this.region = region;
  }

  async generateSpeech(
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    const language = toTtsLanguage(input.language);
    if (!language) {
      throw new TtsError(
        "unsupported_language",
        `Language "${input.language}" is not supported for voice.`
      );
    }
    const voiceId = pollyVoiceId(language, input.voice);
    if (!voiceId) {
      throw new TtsError(
        "unsupported_voice",
        `Voice "${input.voice}" is not available for ${language}.`
      );
    }
    if (!input.text.trim()) {
      throw new TtsError("empty_text", "There is no narration to speak.");
    }

    // Lazy import so the SDK only loads when Polly is actually used.
    const { PollyClient, SynthesizeSpeechCommand } = await import(
      "@aws-sdk/client-polly"
    );
    const client = new PollyClient({
      region: this.region,
      maxAttempts: 4,
      retryMode: "adaptive",
    });

    let audioBytes: Uint8Array;
    try {
      const res = await client.send(
        new SynthesizeSpeechCommand({
          Text: input.text,
          OutputFormat: "mp3",
          // The SDK types VoiceId/LanguageCode as branded string enums; our
          // mapping produces valid values, so we cast the plain strings.
          VoiceId: voiceId as import("@aws-sdk/client-polly").VoiceId,
          Engine: pollyEngineFor(voiceId),
          LanguageCode:
            LANGUAGE_CODES[language] as import("@aws-sdk/client-polly").LanguageCode,
        })
      );
      if (!res.AudioStream) {
        throw new Error("Polly returned no audio stream.");
      }
      // AudioStream is a stream in Node; collect it to a buffer.
      const bytes = await res.AudioStream.transformToByteArray();
      audioBytes = bytes;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TtsError("provider", `Polly synthesis failed: ${message}`);
    }

    await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
    await fs.writeFile(input.outputPath, audioBytes);

    return {
      audioPath: publicPath(input.outputPath),
      duration: estimateDurationSeconds(input.text, language),
    };
  }
}

// ---------------------------------------------------------------------------
// Mock (offline) provider — writes a valid silent MP3.
// ---------------------------------------------------------------------------

/**
 * A single silent MPEG-1 Layer III frame (44.1kHz, 128kbps, mono). Concatenating
 * N of these produces a valid, playable silent MP3. Header bytes:
 *   FF FB 90 64  = MPEG1 L3, 128kbps, 44.1kHz, no padding.
 * Frame size for 128kbps/44.1kHz = 417 bytes (incl. header). We zero-fill the
 * remainder (silence).
 */
function silentMp3Frame(): Buffer {
  const frame = Buffer.alloc(417);
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;
  return frame;
}

/** ~38.28 frames per second at 44.1kHz for MPEG1 L3 (1152 samples/frame). */
const FRAMES_PER_SECOND = 44100 / 1152;

class MockTtsProvider implements TtsProvider {
  readonly name = "mock";

  async generateSpeech(
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    const language = toTtsLanguage(input.language);
    if (!language) {
      throw new TtsError(
        "unsupported_language",
        `Language "${input.language}" is not supported for voice.`
      );
    }
    if (!pollyVoiceId(language, input.voice)) {
      throw new TtsError(
        "unsupported_voice",
        `Voice "${input.voice}" is not available for ${language}.`
      );
    }
    if (!input.text.trim()) {
      throw new TtsError("empty_text", "There is no narration to speak.");
    }

    const duration = estimateDurationSeconds(input.text, language);
    const frameCount = Math.max(1, Math.round(duration * FRAMES_PER_SECOND));
    const frame = silentMp3Frame();
    const buffer = Buffer.concat(Array.from({ length: frameCount }, () => frame));

    await fs.mkdir(path.dirname(input.outputPath), { recursive: true });
    await fs.writeFile(input.outputPath, buffer);

    // Simulate a little latency so loading states are visible in dev.
    await new Promise((r) => setTimeout(r, 120));

    return { audioPath: publicPath(input.outputPath), duration };
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

/**
 * Select the TTS provider from the environment:
 *   - AUTODEMO_TTS_PROVIDER=mock  -> mock
 *   - AUTODEMO_TTS_PROVIDER=polly -> Polly
 *   - otherwise: Polly if an AWS region is configured, else mock.
 *
 * Keeps the app runnable with no cloud setup while allowing real TTS when
 * credentials/region are present.
 */
export function getTtsProvider(): TtsProvider {
  const explicit = process.env.AUTODEMO_TTS_PROVIDER?.toLowerCase();
  if (explicit === "mock") return new MockTtsProvider();

  const region =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";

  if (explicit === "polly" || region) {
    return new PollyTtsProvider(region || "us-east-1");
  }
  return new MockTtsProvider();
}
