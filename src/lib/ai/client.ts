import type { WebsiteExploration } from "@/lib/browser/types";
import type { DiscoveredFeature } from "@/types";
import {
  featureDiscoveryResponseSchema,
  FEATURE_TOOL_INPUT_SCHEMA,
  type FeatureDiscoveryResponse,
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
  type PlanResponse,
  type SingleSceneResponse,
} from "@/lib/planner/schemas";
import {
  PLANNER_SYSTEM_PROMPT,
  buildPlannerUserText,
  buildSceneRegenUserText,
  type PlannerContext,
} from "@/lib/planner/prompts";

/**
 * AI provider abstraction.
 *
 * The rest of the app depends only on the `MultimodalAiProvider` interface, so
 * the concrete provider (Amazon Bedrock today) can be swapped without touching
 * callers. A deterministic mock provider is used when no cloud credentials are
 * configured, so the app and its tests run without AWS access.
 */

export interface AiUsage {
  /** Provider identifier, e.g. "bedrock" or "mock". */
  provider: string;
  /** Model id / inference profile used. */
  model: string;
  /** Wall-clock duration of the request in milliseconds. */
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Estimated cost in USD, when pricing is known for the model. */
  estimatedCostUsd: number | null;
}

export interface DiscoverFeaturesInput {
  exploration: WebsiteExploration;
  context?: { purpose?: string; audience?: string };
}

export interface DiscoverFeaturesResult {
  response: FeatureDiscoveryResponse;
  usage: AiUsage;
}

export interface PlanDemoInput {
  features: DiscoveredFeature[];
  context: PlannerContext;
}

export interface PlanDemoResult {
  response: PlanResponse;
  usage: AiUsage;
}

export interface RegenerateSceneInput {
  feature: DiscoveredFeature;
  context: PlannerContext;
  guidance?: string;
}

export interface RegenerateSceneResult {
  response: SingleSceneResponse;
  usage: AiUsage;
}

export interface MultimodalAiProvider {
  readonly name: string;
  /**
   * Analyze a captured page (data + screenshots) and return a validated
   * feature list plus usage metadata.
   */
  discoverFeatures(
    input: DiscoverFeaturesInput
  ): Promise<DiscoverFeaturesResult>;
  /**
   * Turn selected features into a validated scene-by-scene demo plan.
   */
  planDemo(input: PlanDemoInput): Promise<PlanDemoResult>;
  /**
   * Regenerate the narration/objective for a single scene's feature.
   */
  regenerateScene(
    input: RegenerateSceneInput
  ): Promise<RegenerateSceneResult>;
}

export class AiError extends Error {
  code: "config" | "provider" | "invalid_response";
  constructor(code: AiError["code"], message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Bedrock provider (Amazon Bedrock Converse API, multimodal + tool use)
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ID = "us.anthropic.claude-sonnet-4-6";
const TOOL_NAME = "report_features";
const PLAN_TOOL_NAME = "report_plan";
const SCENE_TOOL_NAME = "report_scene";
const MAX_TOKENS = 4096;

/** Content block accepted by the Converse API (text or image). */
type ConverseContentBlock =
  | { text: string }
  | { image: { format: "png" | "jpeg"; source: { bytes: Uint8Array } } };

/**
 * Per-1K-token pricing (USD) by model id, used to estimate cost. Pricing
 * changes; keep this table small and treat it as an estimate. Unknown models
 * report null cost.
 */
const PRICING_PER_1K: Record<string, { input: number; output: number }> = {
  "us.anthropic.claude-sonnet-4-6": { input: 0.003, output: 0.015 },
};

function estimateCost(
  model: string,
  inputTokens: number | null,
  outputTokens: number | null
): number | null {
  const p = PRICING_PER_1K[model];
  if (!p || inputTokens == null || outputTokens == null) return null;
  return (inputTokens / 1000) * p.input + (outputTokens / 1000) * p.output;
}

/** Decode a data: URL PNG into raw bytes and format for a Converse image block. */
function dataUrlToImageBytes(dataUrl: string): {
  format: "png" | "jpeg";
  bytes: Uint8Array;
} | null {
  const match = dataUrl.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (!match) return null;
  const format = match[1] === "jpeg" ? "jpeg" : "png";
  const bytes = new Uint8Array(Buffer.from(match[2], "base64"));
  return { format, bytes };
}

class BedrockAiProvider implements MultimodalAiProvider {
  readonly name = "bedrock";
  private readonly model: string;
  private readonly region: string;

  constructor(model: string, region: string) {
    this.model = model;
    this.region = region;
  }

  /**
   * Shared Converse + forced-tool-use call. Sends the content, forces the
   * model to answer via the named tool, and returns the raw tool input plus
   * usage. Callers validate the tool input with their own Zod schema.
   */
  private async runTool(params: {
    logLabel: string;
    system: string;
    content: ConverseContentBlock[];
    toolName: string;
    toolDescription: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    toolSchema: any;
  }): Promise<{ input: unknown; usage: AiUsage }> {
    const {
      BedrockRuntimeClient,
      ConverseCommand,
    } = await import("@aws-sdk/client-bedrock-runtime");

    const client = new BedrockRuntimeClient({
      region: this.region,
      maxAttempts: 5,
      retryMode: "adaptive",
    });

    const started = Date.now();
    let response;
    try {
      response = await client.send(
        new ConverseCommand({
          modelId: this.model,
          system: [{ text: params.system }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          messages: [{ role: "user", content: params.content as any }],
          inferenceConfig: { maxTokens: MAX_TOKENS, temperature: 0 },
          toolConfig: {
            tools: [
              {
                toolSpec: {
                  name: params.toolName,
                  description: params.toolDescription,
                  inputSchema: { json: params.toolSchema },
                },
              },
            ],
            toolChoice: { tool: { name: params.toolName } },
          },
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AiError("provider", `Bedrock request failed: ${message}`);
    }

    const inputTokens = response.usage?.inputTokens ?? null;
    const outputTokens = response.usage?.outputTokens ?? null;
    const totalTokens =
      response.usage?.totalTokens ??
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
      estimatedCostUsd: estimateCost(this.model, inputTokens, outputTokens),
    };
    logUsage(params.logLabel, usage);

    const toolBlock = response.output?.message?.content?.find(
      (b) => b.toolUse
    )?.toolUse;
    if (!toolBlock?.input) {
      throw new AiError(
        "invalid_response",
        "The model did not return structured output."
      );
    }
    return { input: toolBlock.input, usage };
  }

  async discoverFeatures(
    input: DiscoverFeaturesInput
  ): Promise<DiscoverFeaturesResult> {
    const content: ConverseContentBlock[] = [
      { text: buildFeatureDiscoveryUserText(input.exploration, input.context) },
    ];
    for (const shot of input.exploration.screenshots.slice(0, 2)) {
      const img = dataUrlToImageBytes(shot.dataUrl);
      if (img) {
        content.push({
          image: { format: img.format, source: { bytes: img.bytes } },
        });
      }
    }

    const { input: toolInput, usage } = await this.runTool({
      logLabel: "feature_discovery",
      system: FEATURE_DISCOVERY_SYSTEM_PROMPT,
      content,
      toolName: TOOL_NAME,
      toolDescription: "Report the product features discovered on the page.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolSchema: FEATURE_TOOL_INPUT_SCHEMA as any,
    });

    const parsed = featureDiscoveryResponseSchema.safeParse(toolInput);
    if (!parsed.success) {
      throw new AiError(
        "invalid_response",
        `Model output failed validation: ${parsed.error.issues[0]?.message}`
      );
    }
    return { response: parsed.data, usage };
  }

  async planDemo(input: PlanDemoInput): Promise<PlanDemoResult> {
    const { input: toolInput, usage } = await this.runTool({
      logLabel: "demo_plan",
      system: PLANNER_SYSTEM_PROMPT,
      content: [{ text: buildPlannerUserText(input.features, input.context) }],
      toolName: PLAN_TOOL_NAME,
      toolDescription: "Report the scene-by-scene demo plan.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolSchema: PLAN_TOOL_INPUT_SCHEMA as any,
    });

    const parsed = planResponseSchema.safeParse(toolInput);
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
    const { input: toolInput, usage } = await this.runTool({
      logLabel: "scene_regen",
      system: PLANNER_SYSTEM_PROMPT,
      content: [
        {
          text: buildSceneRegenUserText(
            input.feature,
            input.context,
            input.guidance
          ),
        },
      ],
      toolName: SCENE_TOOL_NAME,
      toolDescription: "Report a single regenerated demo scene.",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      toolSchema: SINGLE_SCENE_TOOL_INPUT_SCHEMA as any,
    });

    const parsed = singleSceneResponseSchema.safeParse(toolInput);
    if (!parsed.success) {
      throw new AiError(
        "invalid_response",
        `Scene output failed validation: ${parsed.error.issues[0]?.message}`
      );
    }
    return { response: parsed.data, usage };
  }
}

// ---------------------------------------------------------------------------
// Mock provider (deterministic, no network) — used without cloud credentials.
// ---------------------------------------------------------------------------

class MockAiProvider implements MultimodalAiProvider {
  readonly name = "mock";

  async discoverFeatures(
    input: DiscoverFeaturesInput
  ): Promise<DiscoverFeaturesResult> {
    const started = Date.now();
    const { exploration } = input;

    // Derive plausible features purely from observed evidence, so the mock is
    // honest to the same "evidence only" rule the real prompt enforces.
    const features = deriveMockFeatures(exploration);
    const validated = featureDiscoveryResponseSchema.parse({ features });

    // Simulate a little latency so loading states are visible in dev.
    await new Promise((r) => setTimeout(r, 250));

    const usage: AiUsage = {
      provider: this.name,
      model: "mock-deterministic-v1",
      durationMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: 0,
    };
    logUsage("feature_discovery", usage);
    return { response: validated, usage };
  }

  async planDemo(input: PlanDemoInput): Promise<PlanDemoResult> {
    const started = Date.now();
    const scenes = input.features.map((f) =>
      buildMockScene(f, input.context)
    );
    const validated = planResponseSchema.parse({ scenes });
    await new Promise((r) => setTimeout(r, 200));

    const usage: AiUsage = {
      provider: this.name,
      model: "mock-deterministic-v1",
      durationMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: 0,
    };
    logUsage("demo_plan", usage);
    return { response: validated, usage };
  }

  async regenerateScene(
    input: RegenerateSceneInput
  ): Promise<RegenerateSceneResult> {
    const started = Date.now();
    // Vary the mock narration slightly so "regenerate" produces a visibly
    // different result.
    const scene = buildMockScene(input.feature, input.context, input.guidance);
    const validated = singleSceneResponseSchema.parse({ scene });
    await new Promise((r) => setTimeout(r, 150));

    const usage: AiUsage = {
      provider: this.name,
      model: "mock-deterministic-v1",
      durationMs: Date.now() - started,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      estimatedCostUsd: 0,
    };
    logUsage("scene_regen", usage);
    return { response: validated, usage };
  }
}

/**
 * Build a deterministic mock scene for a feature, honouring the same
 * evidence-only rule and roughly hitting the per-scene word target so the mock
 * behaves like the real planner for testing.
 */
function buildMockScene(
  feature: DiscoveredFeature,
  ctx: PlannerContext,
  guidance?: string
): PlanResponse["scenes"][number] {
  const evidenceText =
    feature.evidence.length > 0
      ? feature.evidence.join("; ")
      : feature.name;

  // Purpose-flavoured opener so different purposes read differently.
  const opener: Record<string, string> = {
    hackathon_demo: `Here is what makes ${feature.name} stand out:`,
    customer_tutorial: `Let's walk through ${feature.name} step by step.`,
    portfolio_demo: `Take a look at ${feature.name} and how it's built.`,
    product_overview: `Next up is ${feature.name}.`,
    sales_demo: `${feature.name} helps you get more done.`,
  };

  const lead = opener[ctx.purpose] ?? `Next up is ${feature.name}.`;
  const guidanceNote = guidance ? ` ${guidance.trim()}` : "";

  // Compose narration around the observed evidence, padded toward the target
  // word count without inventing capabilities.
  const narration =
    `${lead} ${feature.description} ` +
    `On the page we can see ${evidenceText}, which is what this scene highlights.` +
    guidanceNote;

  return {
    featureId: feature.id,
    title: feature.name,
    objective: `Help the ${ctx.audience || "viewer"} understand ${feature.name} using only what is visible on the page.`,
    narration,
    estimatedDuration: Math.max(
      6,
      Math.round(ctx.durationPlan.perSceneSpeakingSeconds)
    ),
    evidence: feature.evidence.slice(0, 6),
  };
}

function deriveMockFeatures(exploration: WebsiteExploration) {
  const features: FeatureDiscoveryResponse["features"] = [];

  // Top headings become candidate features with heading evidence.
  const headingFeatures = exploration.headings
    .filter((h) => h.level <= 3 && h.text.length >= 3)
    .slice(0, 5);

  for (const h of headingFeatures) {
    const relatedButton = exploration.buttons.find((b) =>
      b.text.toLowerCase().includes(h.text.toLowerCase().split(" ")[0] ?? "")
    );
    const evidence = [`Heading: ${h.text}`];
    if (relatedButton) evidence.push(`Button: ${relatedButton.text}`);
    features.push({
      name: h.text.slice(0, 80),
      description: `Section identified from the page heading "${h.text}".`,
      importance: h.level === 1 ? 0.8 : 0.5,
      confidence: relatedButton ? 0.7 : 0.5,
      evidence,
      safeToDemo: true,
    });
  }

  // A form present on the page is a candidate feature (marked not safe to demo
  // when it looks like sign-up/checkout).
  if (exploration.forms.length > 0) {
    const form = exploration.forms[0];
    const fieldNames = form.fields
      .map((f) => (f.label || f.name || f.type).toLowerCase())
      .join(" ");
    const sensitive = /(password|email|card|checkout|sign)/.test(fieldNames);
    features.push({
      name: sensitive ? "Account / Sign-up" : "On-page Form",
      description: `A ${form.method} form with ${form.fields.length} field(s) is present on the page.`,
      importance: 0.4,
      confidence: 0.6,
      evidence: [
        `Form: ${form.method} with fields ${form.fields
          .map((f) => f.label || f.name || f.type)
          .slice(0, 5)
          .join(", ")}`,
      ],
      safeToDemo: !sensitive,
    });
  }

  // Guarantee at least one feature so downstream UI always has something.
  if (features.length === 0) {
    features.push({
      name: exploration.title || "Landing Page",
      description:
        "The page's primary content, identified from its title and visible text.",
      importance: 0.5,
      confidence: 0.4,
      evidence: [`Title: ${exploration.title || exploration.finalUrl}`],
      safeToDemo: true,
    });
  }

  return features;
}

// ---------------------------------------------------------------------------
// Logging + provider selection
// ---------------------------------------------------------------------------

function logUsage(label: string, usage: AiUsage): void {
  // Structured, single-line log for observability. In production this would go
  // to a metrics sink; console is sufficient for this milestone.
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

/**
 * Select the provider based on environment.
 *
 * - If AUTODEMO_AI_PROVIDER=mock, or no AWS region is configured, use the mock.
 * - Otherwise use Bedrock with the configured (or default) model and region.
 *
 * This keeps the app runnable with zero cloud setup while allowing a real
 * provider in environments that have credentials.
 */
export function getAiProvider(): MultimodalAiProvider {
  const explicit = process.env.AUTODEMO_AI_PROVIDER?.toLowerCase();
  if (explicit === "mock") return new MockAiProvider();

  const region =
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";

  if (explicit === "bedrock" || region) {
    const model = process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL_ID;
    return new BedrockAiProvider(model, region || "us-east-1");
  }

  // Default: no cloud configured -> deterministic mock.
  return new MockAiProvider();
}
