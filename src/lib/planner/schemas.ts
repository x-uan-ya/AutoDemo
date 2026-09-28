import { z } from "zod";

/**
 * Zod schemas for the Demo Planner stage.
 *
 * The model proposes a scene-by-scene plan; its output is untrusted and is
 * validated against these schemas before entering the app. The AI is asked to
 * produce narration + objectives only — durations and ordering are computed /
 * reconciled deterministically in duration-planner.ts, and ids are assigned by
 * the service, so the model's job stays small and reliable.
 */

/**
 * A scene as returned by the model. Note the model does NOT set ids or the
 * final estimatedDuration; those are the planner's responsibility. It DOES
 * propose an estimatedDuration hint we reconcile against the budget.
 */
export const plannedSceneSchema = z.object({
  /** The discovered-feature id this scene showcases. */
  featureId: z.string().min(1),
  title: z.string().min(1).max(120),
  /** What the viewer should understand after this scene. */
  objective: z.string().min(1).max(400),
  /** Spoken narration for the scene. Grounded in the feature's evidence. */
  narration: z.string().min(1).max(1200),
  /** Model's suggested seconds for the scene (reconciled by the planner). */
  estimatedDuration: z.number().min(1).max(120),
  /** Evidence strings copied from the feature that justify the narration. */
  evidence: z.array(z.string().min(1).max(300)).max(12),
});

export type PlannedSceneData = z.infer<typeof plannedSceneSchema>;

export const planResponseSchema = z.object({
  scenes: z.array(plannedSceneSchema).min(1).max(12),
});

export type PlanResponse = z.infer<typeof planResponseSchema>;

/** Schema for regenerating a single scene (model returns just the scene). */
export const singleSceneResponseSchema = z.object({
  scene: plannedSceneSchema,
});

export type SingleSceneResponse = z.infer<typeof singleSceneResponseSchema>;

/**
 * Tool input schema handed to the model to force structured output for a full
 * plan. Kept aligned with `planResponseSchema` by hand.
 */
export const PLAN_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    scenes: {
      type: "array",
      description: "Ordered scenes of the demo, one per selected feature.",
      items: {
        type: "object",
        properties: {
          featureId: {
            type: "string",
            description: "Id of the discovered feature this scene showcases.",
          },
          title: { type: "string", description: "Short scene title." },
          objective: {
            type: "string",
            description: "What the viewer should understand after the scene.",
          },
          narration: {
            type: "string",
            description:
              "Spoken narration, grounded only in the feature's evidence.",
          },
          estimatedDuration: {
            type: "number",
            description: "Suggested spoken seconds for this scene.",
          },
          evidence: {
            type: "array",
            items: { type: "string" },
            description: "Evidence strings from the feature used in narration.",
          },
        },
        required: [
          "featureId",
          "title",
          "objective",
          "narration",
          "estimatedDuration",
          "evidence",
        ],
      },
    },
  },
  required: ["scenes"],
} as const;

/** Tool input schema for regenerating one scene. */
export const SINGLE_SCENE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    scene: PLAN_TOOL_INPUT_SCHEMA.properties.scenes.items,
  },
  required: ["scene"],
} as const;
