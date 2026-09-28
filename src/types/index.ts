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

// The Phase 4 browser action plan and Phase 5 recording result are defined
// alongside the executor/recorder in the browser layer; re-exported here so the
// aggregate can reference them.
import type { ActionPlan, RecordingResult } from "@/lib/browser/types";
export type { ActionPlan, RecordingResult } from "@/lib/browser/types";
// Phase 6 voice-over metadata lives with the TTS layer; re-exported here.
import type { VoiceOver } from "@/lib/tts/types";
export type { VoiceOver } from "@/lib/tts/types";
// Phase 7 render result lives with the video layer; re-exported here.
import type { RenderResult } from "@/video/types";
export type { RenderResult } from "@/video/types";
// Phase 8 multilingual container lives with the i18n layer; re-exported here.
import type { Multilingual } from "@/lib/i18n/types";
export type { Multilingual } from "@/lib/i18n/types";
// Phase 9 quality report lives with the browser layer; re-exported here.
import type { QualityReport, HumanReviewContext } from "@/lib/browser/types";
export type { QualityReport, HumanReviewContext } from "@/lib/browser/types";

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
 * High level status of a demo job.
 *
 * The original lowercase values are retained for back-compat with earlier
 * phases / seed data. Phase 5 adds explicit uppercase phase statuses that track
 * where a job is in the pipeline, including recording outcomes.
 */
export type DemoStatus =
  // Legacy (kept so existing data/UI keep working).
  | "ready_for_exploration"
  | "in_progress"
  | "completed"
  | "failed"
  // Phase-explicit statuses.
  | "DRAFT"
  | "EXPLORING"
  | "PLANNING"
  | "STORYBOARD_READY"
  | "ACTIONS_READY"
  | "RECORDING"
  | "RECORDING_COMPLETE"
  | "RECORDING_FAILED"
  | "VOICE_GENERATING"
  | "VOICE_READY"
  | "VOICE_FAILED"
  | "RENDERING"
  | "RENDER_COMPLETE"
  | "RENDER_FAILED";

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
 * A scene in the demo plan (storyboard), produced by the Demo Planner stage.
 *
 * This is the planning-time representation the user reviews and edits. It is
 * distinct from `DemoScene` (the recording-time representation with concrete
 * browser actions), which is derived later once the storyboard is approved.
 */
export interface PlanScene {
  id: string;
  /** 1-based position in the storyboard. */
  order: number;
  /** The discovered feature this scene showcases. */
  featureId: string;
  title: string;
  /** What the viewer should understand after this scene. */
  objective: string;
  /** Spoken narration. Grounded in the feature's evidence. */
  narration: string;
  /** Planned scene length in seconds. */
  estimatedDuration: number;
  /** Placeholder for recording actions; populated in a later milestone. */
  actions: BrowserAction[];
  /** Evidence strings supporting the narration. */
  evidence: string[];
}

export type PlanStatus = "draft" | "approved";

/**
 * The generated storyboard for a demo, plus the settings snapshot it was
 * generated against and its approval state. Recording must not begin until
 * `status` is "approved".
 */
export interface DemoPlan {
  scenes: PlanScene[];
  status: PlanStatus;
  /** Target duration (seconds) the plan was built for. */
  targetSeconds: number;
  /** The purpose the plan was generated for (plans differ by purpose). */
  purpose: DemoPurpose;
  provider: string;
  model: string;
  /** When the plan was last generated/regenerated (ISO 8601). */
  generatedAt: string;
  /** When the plan was approved, if it has been. */
  approvedAt?: string;
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
  /** The generated storyboard, if the planning stage has run. */
  plan?: DemoPlan;
  /** Phase 4 browser action plan, if it has been generated. */
  actionPlan?: ActionPlan;
  /** Phase 5 recording result, if a recording has run. */
  recording?: RecordingResult;
  /** Phase 6 voice-over (per-scene narration audio), if it has been generated. */
  voiceOver?: VoiceOver;
  /** Phase 7 final rendered video result, if it has been rendered. */
  render?: RenderResult;
  /** Phase 8 multilingual versions (master script + per-language demos). */
  multilingual?: Multilingual;
  /** Phase 9 quality control report, generated after recording. */
  qualityReport?: QualityReport;
  scenes: DemoScene[];
  assets: VideoAsset[];
  createdAt: string;
  updatedAt: string;
}
