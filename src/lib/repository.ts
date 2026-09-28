import type {
  DemoJob,
  DemoSettings,
  DiscoveredFeature,
  FeatureDiscoveryMeta,
  DemoPlan,
  PlanScene,
} from "@/types";
import type {
  ActionPlan,
  PlannedBrowserAction,
  RecordingResult,
} from "@/lib/browser/types";
import type { VoiceOver, SceneAudio } from "@/lib/tts/types";
import type { RenderResult } from "@/video/types";
import type { DemoStatus } from "@/types";
import { MOCK_JOBS } from "@/data/mock-jobs";
import { createInitialPipeline } from "@/lib/pipeline";

/**
 * Persistence boundary for demo jobs.
 *
 * The app talks to this interface only, never to a concrete store. Today the
 * only implementation is an in-memory store seeded with mock data. When the
 * PostgreSQL layer lands, a PgDemoJobRepository can implement the same
 * interface and be swapped in via `getRepository()` with no changes to callers.
 */
export interface DemoJobRepository {
  list(): Promise<DemoJob[]>;
  getById(id: string): Promise<DemoJob | null>;
  create(settings: DemoSettings, title?: string): Promise<DemoJob>;
  /** Replace a job's discovered features and record the AI call metadata. */
  setFeatures(
    id: string,
    features: DiscoveredFeature[],
    meta: FeatureDiscoveryMeta
  ): Promise<DemoJob | null>;
  /** Toggle the `selected` flag of a single feature. */
  setFeatureSelection(
    jobId: string,
    featureId: string,
    selected: boolean
  ): Promise<DemoJob | null>;
  /** Store a freshly generated storyboard (resets it to draft). */
  setPlan(jobId: string, plan: DemoPlan): Promise<DemoJob | null>;
  /** Replace a job's plan scenes (edit narration, reorder, remove). Re-numbers order. */
  setPlanScenes(jobId: string, scenes: PlanScene[]): Promise<DemoJob | null>;
  /** Replace a single scene by id (e.g. after regeneration). */
  updatePlanScene(jobId: string, scene: PlanScene): Promise<DemoJob | null>;
  /** Approve the storyboard, locking it for the recording stage. */
  approvePlan(jobId: string): Promise<DemoJob | null>;
  /** Store a freshly generated Phase 4 action plan (resets it to draft). */
  setActionPlan(jobId: string, actionPlan: ActionPlan): Promise<DemoJob | null>;
  /** Replace the actions of a single scene in the action plan. */
  setSceneActions(
    jobId: string,
    sceneId: string,
    actions: PlannedBrowserAction[]
  ): Promise<DemoJob | null>;
  /** Approve the action plan, unlocking (a later) recording stage. */
  approveActionPlan(jobId: string): Promise<DemoJob | null>;

  // ----- Phase 5: recording -----
  /**
   * Atomically claim the recording slot for a job. Returns false if a
   * recording is already active for that job (duplicate-job guard).
   */
  tryStartRecording(jobId: string): Promise<boolean>;
  /** Store the recording result and set the final status. Releases the slot. */
  finishRecording(
    jobId: string,
    result: RecordingResult
  ): Promise<DemoJob | null>;
  /** Set a job's high-level status. */
  setStatus(jobId: string, status: DemoStatus): Promise<DemoJob | null>;

  // ----- Phase 6: voice -----
  /**
   * Atomically claim the voice-generation slot for a job. Returns false if a
   * voice job is already active (duplicate-job guard). Sets VOICE_GENERATING.
   */
  tryStartVoice(jobId: string): Promise<boolean>;
  /** Store the full voice-over result and set the final status. Releases slot. */
  finishVoiceOver(jobId: string, voiceOver: VoiceOver): Promise<DemoJob | null>;
  /**
   * Replace a single scene's audio (regeneration), preserving all other
   * scenes. Recomputes the overall voice status.
   */
  updateSceneAudio(jobId: string, audio: SceneAudio): Promise<DemoJob | null>;

  // ----- Phase 7: render -----
  /**
   * Atomically claim the render slot for a job. Returns false if a render is
   * already active (duplicate-job guard). Sets RENDERING.
   */
  tryStartRender(jobId: string): Promise<boolean>;
  /** Store the render result and set the final status. Releases the slot. */
  finishRender(jobId: string, render: RenderResult): Promise<DemoJob | null>;
}

function generateId(): string {
  // Short, URL-safe id. A real store would use a DB default (uuid/cuid).
  return "demo_" + Math.random().toString(36).slice(2, 10);
}

function deriveTitle(settings: DemoSettings): string {
  try {
    const host = new URL(settings.websiteUrl).hostname.replace(/^www\./, "");
    return host;
  } catch {
    return "Untitled Demo";
  }
}

/**
 * In-memory implementation. State lives for the lifetime of the server
 * process, which is enough for the foundation milestone and local development.
 */
class InMemoryDemoJobRepository implements DemoJobRepository {
  private jobs: DemoJob[];
  /** Job ids with an in-flight recording — the duplicate-job guard. */
  private recordingInFlight = new Set<string>();
  /** Job ids with an in-flight voice job — the duplicate-job guard. */
  private voiceInFlight = new Set<string>();
  /** Job ids with an in-flight render job — the duplicate-job guard. */
  private renderInFlight = new Set<string>();

  constructor(seed: DemoJob[]) {
    // Clone so we never mutate the exported seed array.
    this.jobs = seed.map((j) => ({ ...j }));
  }

  async list(): Promise<DemoJob[]> {
    return [...this.jobs].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
  }

  async getById(id: string): Promise<DemoJob | null> {
    return this.jobs.find((j) => j.id === id) ?? null;
  }

  async create(settings: DemoSettings, title?: string): Promise<DemoJob> {
    const now = new Date().toISOString();
    const job: DemoJob = {
      id: generateId(),
      title: title?.trim() || deriveTitle(settings),
      settings,
      // A freshly created job has not been processed yet.
      status: "ready_for_exploration",
      pipeline: createInitialPipeline(),
      features: [],
      scenes: [],
      assets: [],
      createdAt: now,
      updatedAt: now,
    };
    this.jobs.push(job);
    return job;
  }

  async setFeatures(
    id: string,
    features: DiscoveredFeature[],
    meta: FeatureDiscoveryMeta
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return null;

    job.features = features;
    job.discoveryMeta = meta;
    job.updatedAt = new Date().toISOString();

    // Advance the pipeline: feature discovery is done, planning is next.
    job.pipeline = job.pipeline.map((step) => {
      if (step.stage === "website_analysis") {
        return { ...step, status: "completed" };
      }
      if (step.stage === "feature_discovery") {
        return { ...step, status: "completed" };
      }
      return step;
    });
    if (job.status === "ready_for_exploration") {
      job.status = "in_progress";
    }

    return job;
  }

  async setFeatureSelection(
    jobId: string,
    featureId: string,
    selected: boolean
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return null;

    const feature = job.features.find((f) => f.id === featureId);
    if (!feature) return null;

    feature.selected = selected;
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async setPlan(jobId: string, plan: DemoPlan): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return null;

    job.plan = plan;
    job.updatedAt = new Date().toISOString();

    // Planning has produced a draft; mark the stage active (not completed —
    // that happens on approval). Feature discovery is implied complete.
    job.pipeline = job.pipeline.map((step) => {
      if (
        step.stage === "website_analysis" ||
        step.stage === "feature_discovery"
      ) {
        return { ...step, status: "completed" };
      }
      if (step.stage === "demo_planning") {
        return { ...step, status: "active" };
      }
      return step;
    });
    if (job.status === "ready_for_exploration") job.status = "in_progress";

    return job;
  }

  async setPlanScenes(
    jobId: string,
    scenes: PlanScene[]
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.plan) return null;

    // Re-number order and reset to draft: any structural edit un-approves.
    job.plan.scenes = scenes.map((s, i) => ({ ...s, order: i + 1 }));
    job.plan.status = "draft";
    job.plan.approvedAt = undefined;
    job.plan.generatedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    this.markPlanningActive(job);
    return job;
  }

  async updatePlanScene(
    jobId: string,
    scene: PlanScene
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.plan) return null;

    const idx = job.plan.scenes.findIndex((s) => s.id === scene.id);
    if (idx === -1) return null;

    job.plan.scenes[idx] = { ...scene, order: idx + 1 };
    // Editing a scene un-approves the storyboard.
    job.plan.status = "draft";
    job.plan.approvedAt = undefined;
    job.updatedAt = new Date().toISOString();
    this.markPlanningActive(job);
    return job;
  }

  async approvePlan(jobId: string): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.plan || job.plan.scenes.length === 0) return null;

    const now = new Date().toISOString();
    job.plan.status = "approved";
    job.plan.approvedAt = now;
    job.updatedAt = now;

    // Approval completes the planning stage and unlocks recording.
    job.pipeline = job.pipeline.map((step) =>
      step.stage === "demo_planning"
        ? { ...step, status: "completed" }
        : step
    );
    return job;
  }

  /** Ensure the demo_planning stage shows as active while a draft exists. */
  private markPlanningActive(job: DemoJob): void {
    job.pipeline = job.pipeline.map((step) =>
      step.stage === "demo_planning" && step.status !== "completed"
        ? { ...step, status: "active" }
        : step
    );
  }

  async setActionPlan(
    jobId: string,
    actionPlan: ActionPlan
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    job.actionPlan = actionPlan;
    job.updatedAt = new Date().toISOString();
    // Recording stage becomes active once actions exist (still gated on
    // action-plan approval before it can run).
    job.pipeline = job.pipeline.map((step) =>
      step.stage === "recording" && step.status === "pending"
        ? { ...step, status: "active" }
        : step
    );
    return job;
  }

  async setSceneActions(
    jobId: string,
    sceneId: string,
    actions: PlannedBrowserAction[]
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.actionPlan) return null;

    const scene = job.actionPlan.scenes.find((s) => s.sceneId === sceneId);
    if (!scene) return null;

    scene.actions = actions;
    // Any edit un-approves the action plan and recomputes the flagged summary.
    job.actionPlan.status = "draft";
    job.actionPlan.approvedAt = undefined;
    job.actionPlan.hasFlaggedActions = job.actionPlan.scenes.some((s) =>
      s.actions.some((a) => a.requiresHumanApproval)
    );
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async approveActionPlan(jobId: string): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.actionPlan || job.actionPlan.scenes.length === 0) {
      return null;
    }
    const now = new Date().toISOString();
    job.actionPlan.status = "approved";
    job.actionPlan.approvedAt = now;
    // Actions approved -> job is ready to record.
    job.status = "ACTIONS_READY";
    job.updatedAt = now;
    return job;
  }

  async tryStartRecording(jobId: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    // Duplicate-job guard: refuse if a recording is already in flight.
    if (this.recordingInFlight.has(jobId)) return false;

    this.recordingInFlight.add(jobId);
    job.status = "RECORDING";
    job.pipeline = job.pipeline.map((step) =>
      step.stage === "recording" ? { ...step, status: "active" } : step
    );
    job.updatedAt = new Date().toISOString();
    return true;
  }

  async finishRecording(
    jobId: string,
    result: RecordingResult
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    // Always release the slot, even if the job vanished.
    this.recordingInFlight.delete(jobId);
    if (!job) return null;

    job.recording = result;
    job.status = result.success ? "RECORDING_COMPLETE" : "RECORDING_FAILED";
    job.pipeline = job.pipeline.map((step) =>
      step.stage === "recording"
        ? { ...step, status: result.success ? "completed" : "failed" }
        : step
    );
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async setStatus(
    jobId: string,
    status: DemoStatus
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return null;
    job.status = status;
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async tryStartVoice(jobId: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    if (this.voiceInFlight.has(jobId)) return false;

    this.voiceInFlight.add(jobId);
    job.status = "VOICE_GENERATING";
    job.updatedAt = new Date().toISOString();
    return true;
  }

  async finishVoiceOver(
    jobId: string,
    voiceOver: VoiceOver
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    this.voiceInFlight.delete(jobId);
    if (!job) return null;

    job.voiceOver = voiceOver;
    // Overall job status mirrors the voice-over outcome.
    job.status =
      voiceOver.status === "voice_failed" ? "VOICE_FAILED" : "VOICE_READY";
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async updateSceneAudio(
    jobId: string,
    audio: SceneAudio
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job || !job.voiceOver) return null;

    const idx = job.voiceOver.scenes.findIndex(
      (s) => s.sceneId === audio.sceneId
    );
    if (idx === -1) return null;

    // Preserve all other scenes; replace only this one.
    job.voiceOver.scenes[idx] = audio;

    // Recompute overall voice status from the preserved set.
    const allFailed = job.voiceOver.scenes.every((s) => s.status === "failed");
    job.voiceOver.status = allFailed ? "voice_failed" : "voice_ready";
    job.status = allFailed ? "VOICE_FAILED" : "VOICE_READY";
    job.updatedAt = new Date().toISOString();
    return job;
  }

  async tryStartRender(jobId: string): Promise<boolean> {
    const job = this.jobs.find((j) => j.id === jobId);
    if (!job) return false;
    if (this.renderInFlight.has(jobId)) return false;

    this.renderInFlight.add(jobId);
    job.status = "RENDERING";
    job.pipeline = job.pipeline.map((step) =>
      step.stage === "video_rendering" ? { ...step, status: "active" } : step
    );
    job.updatedAt = new Date().toISOString();
    return true;
  }

  async finishRender(
    jobId: string,
    render: RenderResult
  ): Promise<DemoJob | null> {
    const job = this.jobs.find((j) => j.id === jobId);
    this.renderInFlight.delete(jobId);
    if (!job) return null;

    job.render = render;
    const ok = render.status === "render_complete";
    job.status = ok ? "RENDER_COMPLETE" : "RENDER_FAILED";
    job.pipeline = job.pipeline.map((step) => {
      if (step.stage === "video_rendering") {
        return { ...step, status: ok ? "completed" : "failed" };
      }
      if (step.stage === "completed" && ok) {
        return { ...step, status: "completed" };
      }
      return step;
    });
    if (ok) job.status = "RENDER_COMPLETE";
    job.updatedAt = new Date().toISOString();
    return job;
  }
}

// Singleton across hot reloads in development.
const globalForRepo = globalThis as unknown as {
  __autodemoRepo?: DemoJobRepository;
};

export function getRepository(): DemoJobRepository {
  if (!globalForRepo.__autodemoRepo) {
    globalForRepo.__autodemoRepo = new InMemoryDemoJobRepository(MOCK_JOBS);
  }
  return globalForRepo.__autodemoRepo;
}
