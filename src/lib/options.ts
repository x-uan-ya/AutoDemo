import type {
  DemoDuration,
  DemoLanguage,
  DemoPurpose,
  DemoVoice,
  PipelineStage,
  DemoStatus,
} from "@/types";

/**
 * Human-readable labels for enumerated values, plus ordered option lists used
 * to render <select> controls. Keeping these in one place means the form,
 * cards and detail pages all present values consistently.
 */

export interface Option<T extends string> {
  value: T;
  label: string;
}

export const PURPOSE_OPTIONS: Option<DemoPurpose>[] = [
  { value: "product_overview", label: "Product Overview" },
  { value: "hackathon_demo", label: "Hackathon Demo" },
  { value: "customer_tutorial", label: "Customer Tutorial" },
  { value: "portfolio_demo", label: "Portfolio Demo" },
  { value: "sales_demo", label: "Sales Demo" },
];

export const DURATION_OPTIONS: Option<DemoDuration>[] = [
  { value: "30s", label: "30 seconds" },
  { value: "60s", label: "60 seconds" },
  { value: "90s", label: "90 seconds" },
  { value: "120s", label: "2 minutes" },
];

export const LANGUAGE_OPTIONS: Option<DemoLanguage>[] = [
  { value: "english", label: "English" },
  { value: "mandarin", label: "Mandarin Chinese" },
  { value: "malay", label: "Malay" },
  { value: "japanese", label: "Japanese" },
  { value: "korean", label: "Korean" },
];

export const VOICE_OPTIONS: Option<DemoVoice>[] = [
  { value: "professional_female", label: "Professional Female" },
  { value: "professional_male", label: "Professional Male" },
  { value: "friendly_female", label: "Friendly Female" },
  { value: "friendly_male", label: "Friendly Male" },
];

export const PIPELINE_STAGE_LABELS: Record<PipelineStage, string> = {
  website_analysis: "Website Analysis",
  feature_discovery: "Feature Discovery",
  demo_planning: "Demo Planning",
  recording: "Recording",
  voice_generation: "Voice Generation",
  video_rendering: "Video Rendering",
  completed: "Completed",
};

/** Canonical ordering of pipeline stages. */
export const PIPELINE_ORDER: PipelineStage[] = [
  "website_analysis",
  "feature_discovery",
  "demo_planning",
  "recording",
  "voice_generation",
  "video_rendering",
  "completed",
];

export const STATUS_LABELS: Record<DemoStatus, string> = {
  ready_for_exploration: "Ready for Exploration",
  in_progress: "In Progress",
  completed: "Completed",
  failed: "Failed",
  DRAFT: "Draft",
  EXPLORING: "Exploring",
  PLANNING: "Planning",
  STORYBOARD_READY: "Storyboard Ready",
  ACTIONS_READY: "Actions Ready",
  RECORDING: "Recording",
  RECORDING_COMPLETE: "Recording Complete",
  RECORDING_FAILED: "Recording Failed",
  VOICE_GENERATING: "Generating Voice",
  VOICE_READY: "Voice Ready",
  VOICE_FAILED: "Voice Failed",
  RENDERING: "Rendering",
  RENDER_COMPLETE: "Render Complete",
  RENDER_FAILED: "Render Failed",
};

// Convenience lookup helpers.
export function labelFor<T extends string>(
  options: Option<T>[],
  value: T
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}
