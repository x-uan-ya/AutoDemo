import type { DemoJob } from "@/types";

/**
 * Seed data used to populate the dashboard and detail pages during the
 * foundation milestone. This stands in for the PostgreSQL-backed store that
 * will replace it. None of these represent real generated demos.
 */
export const MOCK_JOBS: DemoJob[] = [
  {
    id: "demo_a1b2c3",
    title: "Acme Analytics",
    settings: {
      websiteUrl: "https://analytics.acme.example",
      purpose: "product_overview",
      audience: "Prospective enterprise customers",
      duration: "90s",
      language: "english",
      voice: "professional_female",
      additionalInstructions:
        "Emphasize the real-time dashboard and export features.",
    },
    status: "ready_for_exploration",
    pipeline: [
      { stage: "website_analysis", status: "pending" },
      { stage: "feature_discovery", status: "pending" },
      { stage: "demo_planning", status: "pending" },
      { stage: "recording", status: "pending" },
      { stage: "voice_generation", status: "pending" },
      { stage: "video_rendering", status: "pending" },
      { stage: "completed", status: "pending" },
    ],
    features: [],
    scenes: [],
    assets: [],
    createdAt: "2026-09-24T09:15:00.000Z",
    updatedAt: "2026-09-24T09:15:00.000Z",
  },
  {
    id: "demo_d4e5f6",
    title: "Nimbus Notes",
    settings: {
      websiteUrl: "https://nimbusnotes.example/app",
      purpose: "customer_tutorial",
      audience: "New users onboarding to the free plan",
      duration: "60s",
      language: "english",
      voice: "friendly_male",
      additionalInstructions: "",
    },
    status: "ready_for_exploration",
    pipeline: [
      { stage: "website_analysis", status: "pending" },
      { stage: "feature_discovery", status: "pending" },
      { stage: "demo_planning", status: "pending" },
      { stage: "recording", status: "pending" },
      { stage: "voice_generation", status: "pending" },
      { stage: "video_rendering", status: "pending" },
      { stage: "completed", status: "pending" },
    ],
    features: [],
    scenes: [],
    assets: [],
    createdAt: "2026-09-20T14:42:00.000Z",
    updatedAt: "2026-09-20T14:42:00.000Z",
  },
  {
    id: "demo_g7h8i9",
    title: "Orbit Commerce",
    settings: {
      websiteUrl: "https://shop.orbit.example",
      purpose: "sales_demo",
      audience: "Retail merchants evaluating checkout",
      duration: "120s",
      language: "mandarin",
      voice: "professional_male",
      additionalInstructions: "Walk through the checkout flow end to end.",
    },
    status: "ready_for_exploration",
    pipeline: [
      { stage: "website_analysis", status: "pending" },
      { stage: "feature_discovery", status: "pending" },
      { stage: "demo_planning", status: "pending" },
      { stage: "recording", status: "pending" },
      { stage: "voice_generation", status: "pending" },
      { stage: "video_rendering", status: "pending" },
      { stage: "completed", status: "pending" },
    ],
    features: [],
    scenes: [],
    assets: [],
    createdAt: "2026-09-12T11:05:00.000Z",
    updatedAt: "2026-09-12T11:05:00.000Z",
  },
];
