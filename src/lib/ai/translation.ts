import type { DemoLanguageCode } from "@/lib/i18n/demo-language";
import { getLanguageDef, isMasterLanguage } from "@/lib/i18n/demo-language";

/**
 * Phase 8 — narration translation.
 *
 * Translates the master (English) scene narration into a target language for
 * spoken narration. Kept separate from the MultimodalAiProvider so the
 * translation concern stays decoupled from feature discovery / planning.
 *
 * Translation rules (encoded in the prompt):
 *   - preserve meaning; adapt for natural spoken phrasing (not word-for-word)
 *   - do NOT translate brand names / product names
 *   - keep feature names, technical terms, numbers, and URLs intact
 *
 * Provider selection mirrors the rest of the app: Amazon Bedrock when AWS is
 * configured (or AUTODEMO_AI_PROVIDER=bedrock), otherwise an offline mock that
 * marks text without calling the network (so the app runs with zero setup).
 */

const DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";
const MAX_TOKENS = 2048;

export class TranslationError extends Error {
  code: "config" | "provider" | "invalid_response";
  constructor(code: TranslationError["code"], message: string) {
    super(message);
    this.name = "TranslationError";
    this.code = code;
  }
}

export interface TranslateInput {
  /** Master (English) texts to translate, in order. */
  texts: string[];
  target: DemoLanguageCode;
  /** Brand/product names to leave untranslated (best-effort hint). */
  doNotTranslate?: string[];
}

export interface TranslateResult {
  /** Translated texts, aligned 1:1 with the input. */
  texts: string[];
  provider: string;
  model: string;
}

function buildSystemPrompt(target: DemoLanguageCode): string {
  const def = getLanguageDef(target);
  return `You are a professional localizer for AutoDemo product demo narration.

Translate each English narration line into ${def.displayName} (${def.locale}) for spoken narration.

RULES:
1. Preserve meaning. Adapt phrasing so it sounds natural when spoken aloud — do NOT translate word-for-word if that would sound awkward.
2. Do NOT translate brand names or product names. Leave them in their original form.
3. Keep feature names, technical terms, numbers, currency, and URLs exactly as-is.
4. Keep roughly the same length/intent so scene timing stays similar.
5. Output ONLY the translations, one per line, in the same order, with no numbering, quotes, or commentary.`;
}

/** The Bedrock translator (Converse API). */
async function bedrockTranslate(
  input: TranslateInput,
  region: string,
  model: string
): Promise<TranslateResult> {
  const { BedrockRuntimeClient, ConverseCommand } = await import(
    "@aws-sdk/client-bedrock-runtime"
  );
  const client = new BedrockRuntimeClient({
    region,
    maxAttempts: 4,
    retryMode: "adaptive",
  });

  // A unique separator lets us split the response back into lines robustly.
  const SEP = "\n<<<SCENE>>>\n";
  const numbered = input.texts.join(SEP);
  const dnt =
    input.doNotTranslate && input.doNotTranslate.length > 0
      ? `\n\nDo not translate these names: ${input.doNotTranslate.join(", ")}.`
      : "";

  const userText = `Translate the following ${input.texts.length} narration line(s). They are separated by the exact marker "${SEP.trim()}". Return the translations separated by the same marker, in the same order.${dnt}\n\n${numbered}`;

  let response;
  try {
    response = await client.send(
      new ConverseCommand({
        modelId: model,
        system: [{ text: buildSystemPrompt(input.target) }],
        messages: [{ role: "user", content: [{ text: userText }] }],
        inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0.2 },
      })
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TranslationError("provider", `Translation request failed: ${message}`);
  }

  const out =
    response.output?.message?.content?.find((b) => b.text)?.text ?? "";
  const parts = out
    .split(/<<<SCENE>>>/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (parts.length !== input.texts.length) {
    // Fall back to line-splitting if the marker got dropped.
    const lines = out
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length === input.texts.length) {
      return { texts: lines, provider: "bedrock", model };
    }
    throw new TranslationError(
      "invalid_response",
      `Expected ${input.texts.length} translations, got ${parts.length}.`
    );
  }

  return { texts: parts, provider: "bedrock", model };
}

/**
 * Offline mock translator. Does not call the network. For English it returns
 * the text unchanged; for other languages it prefixes a language tag so the
 * pipeline (voice + captions + separate video) is fully exercisable without
 * cloud access. It preserves URLs/numbers because it never alters the text
 * body — honest to the "no network" constraint.
 */
function mockTranslate(input: TranslateInput): TranslateResult {
  if (isMasterLanguage(input.target)) {
    return { texts: [...input.texts], provider: "mock", model: "mock-translate-v1" };
  }
  const def = getLanguageDef(input.target);
  const texts = input.texts.map((t) => `[${def.locale}] ${t}`);
  return { texts, provider: "mock", model: "mock-translate-v1" };
}

/**
 * Translate narration lines into the target language. English (master) passes
 * through unchanged. Aligns output 1:1 with input.
 */
export async function translateNarration(
  input: TranslateInput
): Promise<TranslateResult> {
  if (input.texts.length === 0) {
    return { texts: [], provider: "none", model: "-" };
  }

  // English is the master script — no translation needed.
  if (isMasterLanguage(input.target)) {
    return { texts: [...input.texts], provider: "passthrough", model: "-" };
  }

  const explicit = process.env.AUTODEMO_AI_PROVIDER?.toLowerCase();
  if (explicit === "mock") return mockTranslate(input);

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";
  if (explicit === "bedrock" || region) {
    const model = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
    return bedrockTranslate(input, region || "us-east-1", model);
  }

  // No cloud configured -> deterministic mock.
  return mockTranslate(input);
}
