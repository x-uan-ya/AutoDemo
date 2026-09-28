import { z } from "zod";

/**
 * Zod schema for the create-demo form. This is the single source of truth for
 * validation; the create page infers its form type from it, and any future API
 * route can reuse the same schema to validate request bodies server-side.
 */
export const demoSettingsSchema = z.object({
  websiteUrl: z
    .string()
    .min(1, "Website URL is required")
    .url("Enter a valid URL (including https://)"),
  purpose: z.enum([
    "product_overview",
    "hackathon_demo",
    "customer_tutorial",
    "portfolio_demo",
    "sales_demo",
  ]),
  audience: z.string().min(1, "Audience is required"),
  duration: z.enum(["30s", "60s", "90s", "120s"]),
  language: z.enum(["english", "mandarin", "malay", "japanese", "korean"]),
  voice: z.enum([
    "professional_female",
    "professional_male",
    "friendly_female",
    "friendly_male",
  ]),
  additionalInstructions: z.string().max(2000).optional(),
});

export type DemoSettingsInput = z.infer<typeof demoSettingsSchema>;
