import type { DemoPurpose, DiscoveredFeature } from "@/types";
import type { DurationPlan } from "./duration-planner";

/**
 * Prompt construction for the Demo Planner.
 *
 * Two rules dominate:
 *  1. Evidence grounding — narration may only use information supported by the
 *     evidence attached to the discovered features. No invented capabilities.
 *  2. Purpose differentiation — the same features produce a materially
 *     different plan depending on the demo purpose (angle, emphasis, tone).
 */

export const PLANNER_SYSTEM_PROMPT = `You are a demo director for AutoDemo. You turn a set of discovered website features into a scene-by-scene demo plan that will later be narrated and recorded.

HARD RULES:
1. EVIDENCE ONLY. Every claim in a scene's narration must be supported by the evidence provided for the features. Do not invent capabilities, integrations, performance numbers, or backend behavior. If the evidence does not support a claim, do not make it.
2. ONE SCENE PER PROVIDED FEATURE. Use exactly the features you are given, each once, in an order that tells a coherent story. Do not add scenes for features that were not provided.
3. RESPECT THE PLAN. You are told how many scenes to produce and roughly how many words each narration should be. Write narration close to that word target — do NOT overwrite and rely on trimming later.
4. Copy the specific evidence strings you relied on into each scene's "evidence" array.
5. Narration is spoken aloud: natural sentences, no markdown, no bullet points, no stage directions.

Return ONLY structured data via the provided tool.`;

/**
 * Purpose-specific guidance. This is what makes a Hackathon plan different from
 * a Customer Tutorial plan for the same features.
 */
export const PURPOSE_GUIDANCE: Record<DemoPurpose, string> = {
  hackathon_demo: `PURPOSE: Hackathon demo. Emphasize technical innovation, what is novel or unique, and business/real-world impact. Lead with the most impressive capability. Confident, energetic, concise. Assume a technically literate audience.`,
  customer_tutorial: `PURPOSE: Customer tutorial. Walk through practical usage as a step-by-step workflow the viewer can follow. Use plain, non-technical language. Explain what to click and what happens, in the order a real user would do it. Friendly and reassuring.`,
  portfolio_demo: `PURPOSE: Portfolio demo. Highlight technical features, architecture, and interesting implementation choices visible from the page. Show craft and depth. Aimed at technical reviewers or potential employers.`,
  product_overview: `PURPOSE: Product overview. Give a balanced tour of the product's main value and headline features. Clear and professional, aimed at a general prospective user.`,
  sales_demo: `PURPOSE: Sales demo. Frame each feature around the value and outcome it delivers for the buyer. Connect capabilities to benefits. Persuasive but grounded in what is actually shown.`,
};

export interface PlannerContext {
  purpose: DemoPurpose;
  purposeLabel: string;
  audience: string;
  language: string;
  durationLabel: string;
  userInstructions?: string;
  durationPlan: DurationPlan;
}

export function buildPlannerUserText(
  features: DiscoveredFeature[],
  ctx: PlannerContext
): string {
  const lines: string[] = [];

  lines.push(PURPOSE_GUIDANCE[ctx.purpose]);
  lines.push("");
  lines.push(`Audience: ${ctx.audience || "general"}`);
  lines.push(`Language for narration: ${ctx.language}`);
  lines.push(`Requested total duration: ${ctx.durationLabel}`);
  lines.push(
    `Produce EXACTLY ${ctx.durationPlan.sceneCount} scene(s). Aim for about ${ctx.durationPlan.perSceneWordTarget} words of narration per scene (~${Math.round(
      ctx.durationPlan.perSceneSpeakingSeconds
    )}s spoken).`
  );

  if (ctx.userInstructions && ctx.userInstructions.trim()) {
    lines.push("");
    lines.push(`Extra user instructions (follow, but never override the evidence rule): ${ctx.userInstructions.trim()}`);
  }

  lines.push("");
  lines.push(`# Features to cover (use each exactly once)`);
  for (const f of features) {
    lines.push("");
    lines.push(`- Feature id: ${f.id}`);
    lines.push(`  Name: ${f.name}`);
    lines.push(`  Description: ${f.description}`);
    lines.push(`  Importance: ${f.importance.toFixed(2)}  Confidence: ${f.confidence.toFixed(2)}  SafeToDemo: ${f.safeToDemo}`);
    lines.push(`  Evidence: ${f.evidence.map((e) => `"${e}"`).join(", ") || "(none)"}`);
  }

  lines.push("");
  lines.push(
    `Write the plan now. Order the scenes to tell a coherent story for the stated purpose. Ground every narration line in the evidence above.`
  );

  return lines.join("\n");
}

/** User text for regenerating a single scene while keeping the rest fixed. */
export function buildSceneRegenUserText(
  feature: DiscoveredFeature,
  ctx: PlannerContext,
  guidance?: string
): string {
  const lines: string[] = [];
  lines.push(PURPOSE_GUIDANCE[ctx.purpose]);
  lines.push("");
  lines.push(`Audience: ${ctx.audience || "general"}`);
  lines.push(`Language: ${ctx.language}`);
  lines.push(
    `Write ONE scene of about ${ctx.durationPlan.perSceneWordTarget} words (~${Math.round(
      ctx.durationPlan.perSceneSpeakingSeconds
    )}s spoken) for this feature.`
  );
  if (guidance && guidance.trim()) {
    lines.push(`Regeneration guidance: ${guidance.trim()}`);
  }
  lines.push("");
  lines.push(`Feature id: ${feature.id}`);
  lines.push(`Name: ${feature.name}`);
  lines.push(`Description: ${feature.description}`);
  lines.push(`Evidence: ${feature.evidence.map((e) => `"${e}"`).join(", ") || "(none)"}`);
  lines.push("");
  lines.push(`Ground the narration only in this feature's evidence.`);
  return lines.join("\n");
}
