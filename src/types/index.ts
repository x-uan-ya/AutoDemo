/**
 * AutoDemo core domain types.
 *
 * These types describe the full intended data model of AutoDemo, including
 * stages (browser automation, AI planning, TTS, video rendering) that are NOT
 * implemented in this milestone. They exist so the persistence layer, API and
 * UI can be built against a stable shape as those capabilities are added.
 *
 * Nothing in this file performs work. It only describes data.
 */

// ---------------------------------------------------------------------------
// Enumerated option types (kept as string unions so they map cleanly to
// PostgreSQL enums / check constraints later).
// ---------------------------------------------------------------------------

export type DemoPurpose =
  | "product_overview"
  | "hackathon_demo"
  | "customer_tutorial"
  | "portfolio_demo"
  | "sales_demo";

export type DemoDuration = "30s" | "60s" | "90s" | "120s";

export type DemoLanguage =
  | "english"
  | "mandarin"
  | "malay"
  | "japanese"
  | "korean";

export type DemoVoice =
  | "professional_female"
  | "professional_male"
  | "friendly_female"
  | "friendly_male";

/**
 * The stages of the AutoDemo generation pipeline. Order matters: this is the
 * sequence a job moves through. UI renders these in order.
 */
export type PipelineStage =
  | "website_analysis"
  | "feature_discovery"
  | "demo_planning"
  | "recording"
  | "voice_generation"
  | "video_rendering"
  | "completed";

/**
 * High level status of a demo job. "ready_for_exploration" is the initial
 * state of a newly created (mock) job in this milestone.
 */
export type DemoStatus =
  | "ready_for_exploration"
  | "in_progress"
  | "completed"
  | "failed";

export type StageStatus = "pending" | "active" | "completed" | "failed";

// ---------------------------------------------------------------------------
// Settings supplied by the user when creating a demo.
// ---------------------------------------------------------------------------

export interface DemoSettings {
  websiteUrl: string;
  purpose: DemoPurpose;
  audience: string;
  duration: DemoDuration;
  language: DemoLanguage;
  voice: DemoVoice;
  additionalInstructions?: string;
}

// ---------------------------------------------------------------------------
// Artifacts produced by later pipeline stages. These are placeholders for the
// data shape only; no code produces them yet in this milestone.
// ---------------------------------------------------------------------------

/**
 * A feature discovered on the target website by the AI Feature Discovery stage.
 * Every field is grounded in observable evidence from the page (DOM, visible
 * text, screenshots); the model is instructed not to invent capabilities.
 */
export interface DiscoveredFeature {
  id: string;
  name: string;
  description: string;
  /** How central this feature is to the product. 0..1 */
  importance: number;
  /** The model's confidence that the feature actually exists. 0..1 */
  confidence: number;
  /** Observable evidence supporting the feature (headings, buttons, etc.). */
  evidence: string[];
  /** Whether the feature can be shown by passive navigation (no login/pay). */
  safeToDemo: boolean;
  /** Whether the user has selected this feature for the demo. */
  selected: boolean;
}

/**
 * Metadata about the AI call that produced a job's features. Stored so cost
 * and latency are auditable. Null token/cost fields mean the provider did not
 * report them.
 */
export interface FeatureDiscoveryMeta {
  provider: string;
  model: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  discoveredAt: string;
}

/**
 * A single low level action the (future) browser automation layer will perform
 * while recording. Kept generic so a driver (Playwright, etc.) can map onto it.
 */
export interface BrowserAction {
  id: string;
  type: "navigate" | "click" | "type" | "scroll" | "hover" | "wait";
  /** CSS/text selector the action targets, when applicable. */
  selector?: string;
  /** Value for "navigate" (url) or "type" (text). */
  value?: string;
  /** Milliseconds to wait, for "wait" actions or post-action pauses. */
  durationMs?: number;
}

/**
 * A scene in the storyboard: a chunk of narration paired with the browser
 * actions that should play while it is spoken.
 */
export interface DemoScene {
  id: string;
  order: number;
  title: string;
  /** Narration script for this scene. */
  narration: string;
  actions: BrowserAction[];
  /** Feature ids this scene showcases. */
  featureIds: string[];
  estimatedDurationMs: number;
}

/**
 * A rendered or intermediate media asset (screen recording clip, audio track,
 * final video). Produced by later stages.
 */
export interface VideoAsset {
  id: string;
  kind: "screen_recording" | "narration_audio" | "final_video";
  /** Storage URL/key. Empty until the asset is produced. */
  url: string;
  mimeType: string;
  durationMs?: number;
  sizeBytes?: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// The central aggregate.
// ---------------------------------------------------------------------------

export interface PipelineStageState {
  stage: PipelineStage;
  status: StageStatus;
}

export interface DemoJob {
  id: string;
  title: string;
  settings: DemoSettings;
  status: DemoStatus;
  /** State of each pipeline stage, in order. */
  pipeline: PipelineStageState[];
  features: DiscoveredFeature[];
  /** Metadata about the AI call that produced `features`, if it has run. */
  discoveryMeta?: FeatureDiscoveryMeta;
  scenes: DemoScene[];
  assets: VideoAsset[];
  createdAt: string;
  updatedAt: string;
}
