import {
  featureDiscoveryResponseSchema,
  FEATURE_TOOL_INPUT_SCHEMA,
} from "./schemas";
import {
  FEATURE_DISCOVERY_SYSTEM_PROMPT,
  buildFeatureDiscoveryUserText,
} from "./prompts";
import {
  planResponseSchema,
  singleSceneResponseSchema,
  PLAN_TOOL_INPUT_SCHEMA,
  SINGLE_SCENE_TOOL_INPUT_SCHEMA,
} from "@/lib/planner/schemas";
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserText,
  buildSceneRegenUserText,
} from "@/lib/planner/prompts";
import {
  AiError,
  type MultimodalAiProvider,
  type DiscoverFeaturesInput,
  type DiscoverFeaturesResult,
  type PlanDemoInput,
  type PlanDemoResult,
  type RegenerateSceneInput,
  type RegenerateSceneResult,
  type AiUsage,
} from "./client";

/**
 * Google Gemini provider.
 *
 * Implements the same MultimodalAiProvider contract as the Bedrock and mock
 * providers: multimodal input (page data + screenshots) and structured JSON
 * output validated by the app's Zod schemas. It talks to the Gemini REST
 * `generateContent` endpoint with `fetch` (no SDK dependency), using:
 *   - `inline_data` parts for screenshots (vision), and
 *   - `responseMimeType: application/json` + `responseSchema` to force
 *     well-formed JSON, which we then re-validate with Zod.
 *
 * Website content and screenshots are UNTRUSTED; the system prompts already
 * instruct the model to treat them as data only.
 */

// Stable alias that tracks the current Flash model, so a specific version
// retiring does not break us (override with GEMINI_MODEL).
const DEFAULT_MODEL = "gemini-flash-latest";
const API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/** A Gemini `Part`: text or inline image. */
type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

/** Minimal shape of the Gemini generateContent response we read. */
interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

// ---------------------------------------------------------------------------
// JSON Schema -> Gemini responseSchema conversion
// ---------------------------------------------------------------------------

/**
 * Convert the app's plain JSON-schema objects (lowercase types, as used for
 * Bedrock tool input) into Gemini's response-schema dialect (uppercase `type`
 * enums). Keeps a single source of truth: we reuse the existing tool-input
 * schemas rather than maintaining a second copy.
 */
function toGeminiSchema(node: unknown): Record<string, unknown> {
  if (typeof node !== "object" || node === null) return {};
  const n = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const type = typeof n.type === "string" ? n.type.toLowerCase() : undefined;
  switch (type) {
    case "object": {
      out.type = "OBJECT";
      const props = (n.properties as Record<string, unknown>) ?? {};
      const outProps: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        outProps[key] = toGeminiSchema(value);
      }
      out.properties = outProps;
      if (Array.isArray(n.required)) out.required = n.required;
      break;
    }
    case "array": {
      out.type = "ARRAY";
      if (n.items) out.items = toGeminiSchema(n.items);
      break;
    }
    case "string":
      out.type = "STRING";
      break;
    case "number":
      out.type = "NUMBER";
      break;
    case "integer":
      out.type = "INTEGER";
      break;
    case "boolean":
      out.type = "BOOLEAN";
      break;
    default:
      // Fallback: treat unknown as string to avoid an invalid schema.
      out.type = "STRING";
  }

  if (typeof n.description === "string") out.description = n.description;
  return out;
}

const FEATURE_RESPONSE_SCHEMA = toGeminiSchema(FEATURE_TOOL_INPUT_SCHEMA);
const PLAN_RESPONSE_SCHEMA = toGeminiSchema(PLAN_TOOL_INPUT_SCHEMA);
const SCENE_RESPONSE_SCHEMA = toGeminiSchema(SINGLE_SCENE_TOOL_INPUT_SCHEMA);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

/** Pricing is model-dependent and changes; Gemini free tier reports null cost. */
function logUsage(label: string, usage: AiUsage): void {
  console.info(
    `[ai.${label}] ` +
      JSON.stringify({
        provider: usage.provider,
        model: usage.model,
        durationMs: usage.durationMs,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd: usage.estimatedCostUsd,
      })
  );
}

/** Decode a data: URL image into mime type + base64 payload for inline_data. */
function dataUrlToInlineData(
  dataUrl: string
): { mime_type: string; data: string } | null {
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg));base64,(.+)$/);
  if (!match) return null;
  return { mime_type: match[1], data: match[2] };
}

export class GeminiAiProvider implements MultimodalAiProvider {
  readonly name = "gemini";
  private readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  /**
   * Call generateContent with a system instruction, user parts, and a forced
   * JSON response schema. Returns parsed JSON (unknown) + usage.
   */
  private async runJson(params: {
    logLabel: string;
    system: string;
    parts: GeminiPart[];
    responseSchema: Record<string, unknown>;
  }): Promise<{ data: unknown; usage: AiUsage }> {
    const url = `${API_BASE}/models/${encodeURIComponent(
      this.model
    )}:generateContent`;

    const body = {
      systemInstruction: { parts: [{ text: params.system }] },
      contents: [{ role: "user", parts: params.parts }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: params.responseSchema,
      },
    };

    const started = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Key travels in a header, not the URL, so it is not logged in URLs.
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError("provider", `Gemini request failed: ${message}`);
    }

    if (!res.ok) {
      // Avoid leaking the key; include status + short body for diagnosis.
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 300);
      } catch {
        /* ignore */
      }
      if (res.status === 401 || res.status === 403) {
        throw new AiError(
          "config",
          `Gemini rejected the API key (HTTP ${res.status}). Check GEMINI_API_KEY.`
        );
      }
      throw new AiError(
        "provider",
        `Gemini request failed (HTTP ${res.status}): ${detail}`
      );
    }

    let json: GeminiResponse;
    try {
      json = (await res.json()) as GeminiResponse;
    } catch {
      throw new AiError("invalid_response", "Gemini returned non-JSON.");
    }

    if (json.promptFeedback?.blockReason) {
      throw new AiError(
        "provider",
        `Gemini blocked the request: ${json.promptFeedback.blockReason}`
      );
    }

    const text = json.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();

    if (!text) {
      throw new AiError(
        "invalid_response",
        "Gemini did not return any content."
      );
    }

    const inputTokens = json.usageMetadata?.promptTokenCount ?? null;
    const outputTokens = json.usageMetadata?.candidatesTokenCount ?? null;
    const totalTokens =
      json.usageMetadata?.totalTokenCount ??
      (inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : null);

    const usage: AiUsage = {
      provider: this.name,
      model: this.model,
      durationMs: Date.now() - started,
      inputTokens,
      outputTokens,
      totalTokens,
      // Free-tier / variable pricing — do not guess a cost.
      estimatedCostUsd: null,
    };
    logUsage(params.logLabel, usage);

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new AiError(
        "invalid_response",
        "Gemini returned text that was not valid JSON."
      );
    }
    return { data, usage };
  }

  async discoverFeatures(
    input: DiscoverFeaturesInput
  ): Promise<DiscoverFeaturesResult> {
    const parts: GeminiPart[] = [
      { text: buildFeatureDiscoveryUserText(input.exploration, input.context) },
    ];
    for (const shot of input.exploration.screenshots.slice(0, 2)) {
      const inline = dataUrlToInlineData(shot.dataUrl);
      if (inline) parts.push({ inline_data: inline });
    }

    const { data, usage } = await this.runJson({
      logLabel: "feature_discovery",
      system: FEATURE_DISCOVERY_SYSTEM_PROMPT,
      parts,
      responseSchema: FEATURE_RESPONSE_SCHEMA,
    });

    const parsed = featureDiscoveryResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AiError(
        "invalid_response",
        `Model output failed validation: ${parsed.error.issues[0]?.message}`
      );
    }
    return { response: parsed.data, usage };
  }

  async planDemo(input: PlanDemoInput): Promise<PlanDemoResult> {
    const { data, usage } = await this.runJson({
      logLabel: "demo_plan",
      system: PLANNER_SYSTEM_PROMPT,
      parts: [{ text: buildPlannerUserText(input.features, input.context) }],
      responseSchema: PLAN_RESPONSE_SCHEMA,
    });

    const parsed = planResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AiError(
        "invalid_response",
        `Plan output failed validation: ${parsed.error.issues[0]?.message}`
      );
    }
    return { response: parsed.data, usage };
  }

  async regenerateScene(
    input: RegenerateSceneInput
  ): Promise<RegenerateSceneResult> {
    const { data, usage } = await this.runJson({
      logLabel: "scene_regen",
      system: PLANNER_SYSTEM_PROMPT,
      parts: [
        {
          text: buildSceneRegenUserText(
            input.feature,
            input.context,
            input.guidance
          ),
        },
      ],
      responseSchema: SCENE_RESPONSE_SCHEMA,
    });

    const parsed = singleSceneResponseSchema.safeParse(data);
    if (!parsed.success) {
      throw new AiError(
        "invalid_response",
        `Scene output failed validation: ${parsed.error.issues[0]?.message}`
      );
    }
    return { response: parsed.data, usage };
  }
}
