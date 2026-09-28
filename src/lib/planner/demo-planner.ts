import type { DemoJob, DemoPlan, PlanScene } from "@/types";
import { getAiProvider, AiError } from "@/lib/ai/client";
import { labelFor, DURATION_OPTIONS, PURPOSE_OPTIONS, LANGUAGE_OPTIONS } from "@/lib/options";
import {
  buildDurationPlan,
  selectFeaturesForPlan,
  estimateSpeakingSeconds,
  DURATION_SECONDS,
} from "./duration-planner";
import type { PlannerContext } from "./prompts";

/**
 * Demo Planner service.
 *
 * Orchestrates the planning stage:
 *   1. Build a duration plan (how many scenes fit the target, word budget).
 *   2. Select that many features by value (respecting the user's selection).
 *   3. Ask the AI provider for narration/objectives (validated by Zod inside
 *      the provider).
 *   4. Assign ids, order, and reconcile per-scene durations.
 *
 * The duration is respected by choosing HOW MANY features to cover, not by
 * trimming a long script (see duration-planner.ts).
 */

function sceneId(): string {
  return "scene_" + Math.random().toString(36).slice(2, 10);
}

function buildContext(job: DemoJob): PlannerContext {
  const availableFeatures = job.features.filter((f) => f.selected).length ||
    job.features.length;
  const durationPlan = buildDurationPlan(job.settings.duration, availableFeatures);
  return {
    purpose: job.settings.purpose,
    purposeLabel: labelFor(PURPOSE_OPTIONS, job.settings.purpose),
    audience: job.settings.audience,
    language: labelFor(LANGUAGE_OPTIONS, job.settings.language),
    durationLabel: labelFor(DURATION_OPTIONS, job.settings.duration),
    userInstructions: job.settings.additionalInstructions,
    durationPlan,
  };
}

/**
 * Reconcile the model's per-scene duration hint with the budget: use the
 * spoken-time estimate from the narration, but never below a floor. This keeps
 * the displayed duration honest relative to the actual script.
 */
function reconcileDuration(narration: string, hint: number): number {
  const spoken = estimateSpeakingSeconds(narration);
  return Math.max(4, Math.round(spoken || hint));
}

export async function generatePlan(job: DemoJob): Promise<DemoPlan> {
  if (job.features.length === 0) {
    throw new AiError(
      "config",
      "Run feature discovery before planning the demo."
    );
  }

  const ctx = buildContext(job);
  const features = selectFeaturesForPlan(job.features, ctx.durationPlan.sceneCount);

  if (features.length === 0) {
    throw new AiError(
      "config",
      "No suitable features are available to plan a demo."
    );
  }

  const provider = getAiProvider();
  const { response, usage } = await provider.planDemo({ features, context: ctx });

  // Map to domain scenes. Keep only scenes whose featureId is one we sent, and
  // preserve the model's ordering.
  const allowedIds = new Set(features.map((f) => f.id));
  const scenes: PlanScene[] = response.scenes
    .filter((s) => allowedIds.has(s.featureId))
    .map((s, i) => ({
      id: sceneId(),
      order: i + 1,
      featureId: s.featureId,
      title: s.title,
      objective: s.objective,
      narration: s.narration,
      estimatedDuration: reconcileDuration(s.narration, s.estimatedDuration),
      actions: [],
      evidence: s.evidence,
    }));

  return {
    scenes,
    status: "draft",
    targetSeconds: DURATION_SECONDS[job.settings.duration],
    purpose: job.settings.purpose,
    provider: usage.provider,
    model: usage.model,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Regenerate a single scene's narration/objective, keeping its position and
 * feature. Returns the updated scene (id/order preserved).
 */
export async function regenerateScene(
  job: DemoJob,
  scene: PlanScene,
  guidance?: string
): Promise<PlanScene> {
  const feature = job.features.find((f) => f.id === scene.featureId);
  if (!feature) {
    throw new AiError("config", "The scene's feature no longer exists.");
  }

  const ctx = buildContext(job);
  const provider = getAiProvider();
  const { response } = await provider.regenerateScene({
    feature,
    context: ctx,
    guidance,
  });

  const s = response.scene;
  return {
    ...scene,
    title: s.title,
    objective: s.objective,
    narration: s.narration,
    estimatedDuration: reconcileDuration(s.narration, s.estimatedDuration),
    evidence: s.evidence,
  };
}

export { AiError };
