import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  TtsProvider,
  GenerateSpeechInput,
  GenerateSpeechResult,
  TtsVoice,
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
// Google Gemini provider — real audio, free tier, same key as the AI provider.
// ---------------------------------------------------------------------------

/**
 * Gemini TTS returns raw 16-bit PCM (audio/L16, mono). We wrap it in a minimal
 * WAV container (no dependency) so it is a valid, universally-playable file,
 * and write it with a .wav extension. Consumers store and reuse the returned
 * audioPath verbatim, and both the browser players and Remotion's <Audio>
 * decode by content, so the format swap is transparent.
 */
const GEMINI_TTS_MODEL_DEFAULT = "gemini-2.5-flash-preview-tts";
const GEMINI_TTS_SAMPLE_RATE = 24000; // Hz, from audio/L16;rate=24000
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** Map the app's 4 voices to Gemini prebuilt voices (by tone). */
const GEMINI_VOICES: Record<TtsVoice, string> = {
  professional_female: "Kore",
  professional_male: "Charon",
  friendly_female: "Aoede",
  friendly_male: "Puck",
};

/** Build a 44-byte WAV header for 16-bit mono PCM at the given sample rate. */
function wavHeader(pcmByteLength: number, sampleRate: number): Buffer {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmByteLength, 4); // file size - 8
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM fmt chunk size
  header.writeUInt16LE(1, 20); // audio format = PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmByteLength, 40);
  return header;
}

/** Parse "audio/L16;codec=pcm;rate=24000" -> sample rate (fallback default). */
function sampleRateFromMime(mime: string | undefined): number {
  const m = mime?.match(/rate=(\d+)/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : GEMINI_TTS_SAMPLE_RATE;
}

class GeminiTtsProvider implements TtsProvider {
  readonly name = "gemini";
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
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
    const voiceName = GEMINI_VOICES[input.voice];
    if (!voiceName) {
      throw new TtsError(
        "unsupported_voice",
        `Voice "${input.voice}" is not available.`
      );
    }
    if (!input.text.trim()) {
      throw new TtsError("empty_text", "There is no narration to speak.");
    }

    const url = `${GEMINI_API_BASE}/models/${encodeURIComponent(
      this.model
    )}:generateContent`;
    const body = {
      contents: [{ parts: [{ text: input.text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new TtsError("provider", `Gemini TTS request failed: ${message}`);
    }

    if (!res.ok) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 200);
      } catch {
        /* ignore */
      }
      if (res.status === 401 || res.status === 403) {
        throw new TtsError("config", "Gemini rejected the API key for TTS.");
      }
      throw new TtsError(
        "provider",
        `Gemini TTS failed (HTTP ${res.status}): ${detail}`
      );
    }

    const json = (await res.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            inlineData?: { mimeType?: string; data?: string };
            inline_data?: { mime_type?: string; data?: string };
          }>;
        };
      }>;
    };
    const part = json.candidates?.[0]?.content?.parts?.[0];
    const inline = part?.inlineData ?? part?.inline_data;
    const b64 = inline?.data;
    if (!b64) {
      throw new TtsError("provider", "Gemini TTS returned no audio.");
    }

    const pcm = Buffer.from(b64, "base64");
    const sampleRate = sampleRateFromMime(
      // Both camel and snake case appear across API versions.
      (inline as { mimeType?: string }).mimeType ??
        (inline as { mime_type?: string }).mime_type
    );
    const wav = Buffer.concat([wavHeader(pcm.length, sampleRate), pcm]);

    // Gemini returns PCM/WAV, not MP3 — write a .wav file so the extension is
    // honest. Consumers use the returned audioPath verbatim.
    const wavPath = input.outputPath.replace(/\.[^.]+$/, "") + ".wav";
    await fs.mkdir(path.dirname(wavPath), { recursive: true });
    await fs.writeFile(wavPath, wav);

    // Duration from the actual PCM: bytes / (sampleRate * bytesPerSample).
    const duration = Math.max(
      1,
      Math.round(pcm.length / (sampleRate * 2))
    );

    return { audioPath: publicPath(wavPath), duration };
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const GEMINI_TTS_MODEL =
  process.env.GEMINI_TTS_MODEL?.trim() || GEMINI_TTS_MODEL_DEFAULT;

/**
 * Select the TTS provider from the environment:
 *   - AUTODEMO_TTS_PROVIDER=mock    -> mock (silent)
 *   - AUTODEMO_TTS_PROVIDER=gemini  -> Gemini TTS (needs GEMINI_API_KEY)
 *   - AUTODEMO_TTS_PROVIDER=polly   -> Amazon Polly
 *   - otherwise (auto): Gemini if GEMINI_API_KEY is set, else Polly if an AWS
 *     region is configured, else the silent mock.
 *
 * Keeps the app runnable with no cloud setup while using real TTS when a key
 * or AWS region is present.
 */
export function getTtsProvider(): TtsProvider {
  const explicit = process.env.AUTODEMO_TTS_PROVIDER?.toLowerCase();
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const region =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";

  if (explicit === "mock") return new MockTtsProvider();
  if (explicit === "gemini") {
    if (!geminiKey) {
      throw new TtsError(
        "config",
        "AUTODEMO_TTS_PROVIDER=gemini but GEMINI_API_KEY is not set."
      );
    }
    return new GeminiTtsProvider(geminiKey, GEMINI_TTS_MODEL);
  }
  if (explicit === "polly") return new PollyTtsProvider(region || "us-east-1");

  // Auto-detect when no explicit provider is set.
  if (geminiKey) return new GeminiTtsProvider(geminiKey, GEMINI_TTS_MODEL);
  if (region) return new PollyTtsProvider(region);
  return new MockTtsProvider();
}
