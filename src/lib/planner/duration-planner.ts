import type { DemoDuration, DiscoveredFeature } from "@/types";

/**
 * Duration planning.
 *
 * The core rule of the planner: respect the requested duration by choosing HOW
 * MANY features to cover, not by cramming everything in and trimming scripts.
 * A 30s demo covers fewer, higher-value features than a 2-minute demo.
 *
 * This module is deterministic and has no AI dependency. It:
 *   1. Maps the requested duration option to a target in seconds.
 *   2. Decides how many scenes fit (given per-scene overhead like an intro).
 *   3. Selects the top features by value to fill exactly that many scenes.
 *   4. Budgets a target spoken-seconds allotment per scene.
 *   5. Estimates spoken duration of narration from its word count.
 */

/** Target length in seconds for each duration option. */
export const DURATION_SECONDS: Record<DemoDuration, number> = {
  "30s": 30,
  "60s": 60,
  "90s": 90,
  "120s": 120,
};

/**
 * Average speaking rate in words per second used to estimate narration length.
 * ~150 wpm = 2.5 wps is a natural narration pace.
 */
export const WORDS_PER_SECOND = 2.5;

/** Seconds reserved for on-screen navigation/transition within each scene. */
const PER_SCENE_OVERHEAD_SECONDS = 2;

/** A scene should get at least this many spoken seconds to be worthwhile. */
const MIN_SCENE_SECONDS = 6;
/** ...and no single scene should dominate a short demo. */
const MAX_SCENE_SECONDS = 25;

export interface DurationPlan {
  targetSeconds: number;
  /** How many scenes/features the demo should contain. */
  sceneCount: number;
  /** Target spoken seconds allotted to each scene (before per-scene overhead). */
  perSceneSpeakingSeconds: number;
  /** Target words per scene, derived from perSceneSpeakingSeconds. */
  perSceneWordTarget: number;
}

/**
 * Decide how many scenes fit the target duration. Shorter demos get fewer
 * scenes so each remains substantive rather than rushed.
 */
export function planSceneCount(
  targetSeconds: number,
  availableFeatures: number
): number {
  // Heuristic: aim for roughly one scene per ~18s of content, clamped to a
  // sensible range, then bounded by how many features we actually have.
  const bySeconds = Math.max(1, Math.round(targetSeconds / 18));

  // Explicit caps per bracket so behaviour is predictable and testable.
  let cap: number;
  if (targetSeconds <= 30) cap = 2;
  else if (targetSeconds <= 60) cap = 4;
  else if (targetSeconds <= 90) cap = 5;
  else cap = 7;

  return Math.max(1, Math.min(bySeconds, cap, availableFeatures));
}

/**
 * Build the duration plan for a target and a count of available features.
 */
export function buildDurationPlan(
  duration: DemoDuration,
  availableFeatures: number
): DurationPlan {
  const targetSeconds = DURATION_SECONDS[duration];
  const sceneCount = planSceneCount(targetSeconds, availableFeatures);

  const overhead = sceneCount * PER_SCENE_OVERHEAD_SECONDS;
  const speakingBudget = Math.max(targetSeconds - overhead, sceneCount * MIN_SCENE_SECONDS);

  const perSceneSpeakingSeconds = clamp(
    speakingBudget / sceneCount,
    MIN_SCENE_SECONDS,
    MAX_SCENE_SECONDS
  );

  return {
    targetSeconds,
    sceneCount,
    perSceneSpeakingSeconds,
    perSceneWordTarget: Math.round(perSceneSpeakingSeconds * WORDS_PER_SECOND),
  };
}

/**
 * Select which features to include. Prefers user-selected features; falls back
 * to the highest-value discovered features (importance-weighted, filtered to
 * safe-to-demo) if the selection is empty or too small.
 *
 * Returns exactly `count` features when possible, ordered by descending value.
 */
export function selectFeaturesForPlan(
  features: DiscoveredFeature[],
  count: number
): DiscoveredFeature[] {
  const value = (f: DiscoveredFeature) =>
    f.importance * 0.7 + f.confidence * 0.3;

  const selected = features.filter((f) => f.selected);
  const pool = selected.length > 0 ? selected : features;

  // Prefer safe-to-demo features; keep the rest as a fallback tail so we can
  // still reach `count` if there are not enough safe ones.
  const safe = pool.filter((f) => f.safeToDemo);
  const unsafe = pool.filter((f) => !f.safeToDemo);

  const ordered = [
    ...safe.sort((a, b) => value(b) - value(a)),
    ...unsafe.sort((a, b) => value(b) - value(a)),
  ];

  return ordered.slice(0, count);
}

/** Estimate spoken seconds for a narration string from its word count. */
export function estimateSpeakingSeconds(narration: string): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return 0;
  return Math.round((words / WORDS_PER_SECOND) * 10) / 10;
}

/** Aggregate metrics used by the storyboard UI. */
export interface PlanMetrics {
  sceneCount: number;
  /** Sum of each scene's stored estimatedDuration (seconds). */
  plannedSeconds: number;
  /** Sum of spoken-time estimates derived from narration word counts. */
  estimatedSpeakingSeconds: number;
  targetSeconds: number;
}

export function computePlanMetrics(
  scenes: { estimatedDuration: number; narration: string }[],
  targetSeconds: number
): PlanMetrics {
  const plannedSeconds = scenes.reduce((sum, s) => sum + s.estimatedDuration, 0);
  const estimatedSpeakingSeconds = Math.round(
    scenes.reduce((sum, s) => sum + estimateSpeakingSeconds(s.narration), 0)
  );
  return {
    sceneCount: scenes.length,
    plannedSeconds,
    estimatedSpeakingSeconds,
    targetSeconds,
  };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
