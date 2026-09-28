import type { WebsiteExploration } from "@/lib/browser/types";
import type { DiscoveredFeature, FeatureDiscoveryMeta } from "@/types";
import { getAiProvider, AiError, type DiscoverFeaturesInput } from "./client";

/**
 * Feature Discovery service.
 *
 * Orchestrates the stage: takes a WebsiteExploration (from the Playwright
 * explorer), runs it through the configured multimodal AI provider, and maps
 * the validated result onto the app's domain types. All model output is
 * validated inside the provider before it reaches here.
 */

export interface FeatureDiscoveryOutput {
  features: DiscoveredFeature[];
  meta: FeatureDiscoveryMeta;
}

function featureId(): string {
  return "feat_" + Math.random().toString(36).slice(2, 10);
}

export async function discoverFeatures(
  input: DiscoverFeaturesInput
): Promise<FeatureDiscoveryOutput> {
  const provider = getAiProvider();
  const { response, usage } = await provider.discoverFeatures(input);

  // Sort by importance so the most relevant features surface first, and
  // pre-select the safe, high-confidence ones as a sensible default.
  const features: DiscoveredFeature[] = response.features
    .map((f) => ({
      id: featureId(),
      name: f.name,
      description: f.description,
      importance: f.importance,
      confidence: f.confidence,
      evidence: f.evidence,
      safeToDemo: f.safeToDemo,
      selected: f.safeToDemo && f.confidence >= 0.5,
    }))
    .sort((a, b) => b.importance - a.importance);

  const meta: FeatureDiscoveryMeta = {
    provider: usage.provider,
    model: usage.model,
    durationMs: usage.durationMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    estimatedCostUsd: usage.estimatedCostUsd,
    discoveredAt: new Date().toISOString(),
  };

  return { features, meta };
}

/** Convenience wrapper for callers holding only an exploration object. */
export async function discoverFeaturesFromExploration(
  exploration: WebsiteExploration,
  context?: { purpose?: string; audience?: string }
): Promise<FeatureDiscoveryOutput> {
  return discoverFeatures({ exploration, context });
}

export { AiError };
