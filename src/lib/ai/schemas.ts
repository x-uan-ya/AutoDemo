import { z } from "zod";

/**
 * Zod schemas for the Feature Discovery stage.
 *
 * The model's output is untrusted. Everything it returns is validated against
 * these schemas before it enters the app. The shape here is also the shape we
 * ask the model to produce (see prompts.ts), so the two stay in sync.
 */

/** A single discovered feature, as returned by the model. */
export const discoveredFeatureSchema = z.object({
  /** Short, human-readable feature name. */
  name: z.string().min(1).max(120),
  /** One to three sentences describing what the feature does. */
  description: z.string().min(1).max(600),
  /** How central this feature is to the product. 0..1. */
  importance: z.number().min(0).max(1),
  /** The model's confidence that this feature actually exists. 0..1. */
  confidence: z.number().min(0).max(1),
  /**
   * Concrete evidence from the page that supports this feature. Each item
   * should reference something observable (a heading, button, link, form,
   * or visible screenshot element). This is what keeps the model honest.
   */
  evidence: z.array(z.string().min(1).max(300)).min(1).max(10),
  /**
   * Whether this feature can be demonstrated with passive navigation only
   * (i.e. without logging in, paying, or submitting destructive forms).
   */
  safeToDemo: z.boolean(),
});

export type DiscoveredFeatureData = z.infer<typeof discoveredFeatureSchema>;

/** The full model response: a list of features. */
export const featureDiscoveryResponseSchema = z.object({
  features: z.array(discoveredFeatureSchema).max(25),
});

export type FeatureDiscoveryResponse = z.infer<
  typeof featureDiscoveryResponseSchema
>;

/**
 * JSON Schema handed to the model as a tool input schema, so the provider can
 * enforce structured output. Kept aligned with the Zod schema above by hand
 * (a small, stable shape). Using tool use + this schema makes the model return
 * well-formed JSON, which we then re-validate with Zod.
 */
export const FEATURE_TOOL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    features: {
      type: "array",
      description: "Features discovered on the page, supported by evidence.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short feature name." },
          description: {
            type: "string",
            description: "1-3 sentences on what the feature does.",
          },
          importance: {
            type: "number",
            description: "How central to the product, 0 to 1.",
          },
          confidence: {
            type: "number",
            description: "Confidence the feature exists, 0 to 1.",
          },
          evidence: {
            type: "array",
            items: { type: "string" },
            description:
              "Observable evidence: headings, buttons, links, forms, or screenshot elements.",
          },
          safeToDemo: {
            type: "boolean",
            description:
              "True if demonstrable via passive navigation (no login, payment, or destructive submit).",
          },
        },
        required: [
          "name",
          "description",
          "importance",
          "confidence",
          "evidence",
          "safeToDemo",
        ],
      },
    },
  },
  required: ["features"],
} as const;
