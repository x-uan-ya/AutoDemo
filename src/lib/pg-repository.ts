import type {
  DemoJob,
  DemoSettings,
  DiscoveredFeature,
  FeatureDiscoveryMeta,
  DemoPlan,
  PlanScene,
  DemoStatus,
} from "@/types";
import type {
  ActionPlan,
  PlannedBrowserAction,
  RecordingResult,
  QualityReport,
} from "@/lib/browser/types";
import type { VoiceOver, SceneAudio } from "@/lib/tts/types";
import type { RenderResult } from "@/video/types";
import type { LanguageVersion } from "@/lib/i18n/types";
import type { DemoLanguageCode } from "@/lib/i18n/demo-language";
import { withClient, query } from "@/lib/db/pg";
import { SEED_OWNER_ID } from "@/lib/security/authz";
import { MOCK_JOBS } from "@/data/mock-jobs";
import {
  InMemoryDemoJobRepository,
  type DemoJobRepository,
} from "@/lib/repository";
import type { PoolClient } from "pg";

/**
 * PostgreSQL-backed demo-job repository (Neon / Lakebase).
 *
 * Each DemoJob is stored as one JSONB document in the `demos` table. Mutations
 * run in a transaction that SELECTs the row FOR UPDATE, applies the change, and
 * writes it back — serializing concurrent writers across instances.
 *
 * To avoid duplicating the (tested) mutation logic, document mutations delegate
 * to a throwaway single-job InMemoryDemoJobRepository: load the doc, hand it to
 * the in-memory repo, call the same method, read the mutated job back, persist.
 *
 * The four duplicate-job guards (recording/voice/render/language) are claimed
 * and released against a reserved `_inflight` field inside the same FOR UPDATE
 * transaction, so the guard is atomic and shared across instances (the
 * in-memory repo's per-process Sets cannot be).
 */

/** Reserved in-document field holding duplicate-job guard flags. */
interface InFlight {
  recording?: boolean;
  voice?: boolean;
  render?: boolean;
  languages?: string[];
}

type StoredDoc = DemoJob & { _inflight?: InFlight };

let seeded = false;

export class PgDemoJobRepository implements DemoJobRepository {
  /** Seed the sample demos once (idempotent on id). */
  private async ensureSeeded(): Promise<void> {
    if (seeded) return;
    seeded = true;
    for (const job of MOCK_JOBS) {
      const doc: StoredDoc = { ...job, ownerId: job.ownerId ?? SEED_OWNER_ID };
      await query(
        `INSERT INTO demos (id, owner_id, doc, created_at, updated_at)
         VALUES ($1, $2, $3, now(), now())
         ON CONFLICT (id) DO NOTHING`,
        [doc.id, doc.ownerId, JSON.stringify(doc)]
      );
    }
  }

  /** Strip the reserved _inflight field before returning a DemoJob. */
  private clean(doc: StoredDoc | null | undefined): DemoJob | null {
    if (!doc) return null;
    const { _inflight, ...job } = doc;
    void _inflight;
    return job as DemoJob;
  }

  async list(ownerId: string): Promise<DemoJob[]> {
    await this.ensureSeeded();
    const rows = await query<{ doc: StoredDoc }>(
      `SELECT doc FROM demos
       WHERE owner_id = $1 OR owner_id = $2
       ORDER BY created_at DESC`,
      [ownerId, SEED_OWNER_ID]
    );
    return rows.map((r) => this.clean(r.doc)!);
  }

  async getById(id: string): Promise<DemoJob | null> {
    await this.ensureSeeded();
    const rows = await query<{ doc: StoredDoc }>(
      "SELECT doc FROM demos WHERE id = $1",
      [id]
    );
    return this.clean(rows[0]?.doc);
  }

  async create(
    ownerId: string,
    settings: DemoSettings,
    title?: string
  ): Promise<DemoJob> {
    await this.ensureSeeded();
    // Reuse the in-memory create to build the job shape (id, pipeline, etc.).
    const tmp = new InMemoryDemoJobRepository([]);
    const job = await tmp.create(ownerId, settings, title);
    await query(
      `INSERT INTO demos (id, owner_id, doc, created_at, updated_at)
       VALUES ($1, $2, $3, now(), now())`,
      [job.id, job.ownerId ?? ownerId, JSON.stringify(job)]
    );
    return job;
  }

  // -------------------------------------------------------------------------
  // Transactional read-modify-write helpers
  // -------------------------------------------------------------------------

  /** Load the stored doc for `id` with a row lock. Null if absent. */
  private async lockDoc(
    client: PoolClient,
    id: string
  ): Promise<StoredDoc | null> {
    const res = await client.query<{ doc: StoredDoc }>(
      "SELECT doc FROM demos WHERE id = $1 FOR UPDATE",
      [id]
    );
    return res.rows[0]?.doc ?? null;
  }

  /** Persist the doc back to its row. */
  private async writeDoc(client: PoolClient, doc: StoredDoc): Promise<void> {
    await client.query(
      "UPDATE demos SET doc = $2, updated_at = now() WHERE id = $1",
      [doc.id, JSON.stringify(doc)]
    );
  }

  /**
   * Run a document mutation inside a transaction by delegating to a throwaway
   * single-job in-memory repo (reusing the exact mutation logic). `fn` receives
   * that repo and must call the matching method; the mutated job is persisted.
   * Returns the cleaned result of `fn` (the method's own return), or null when
   * the job does not exist.
   */
  private async mutate(
    id: string,
    fn: (repo: InMemoryDemoJobRepository) => Promise<DemoJob | null>
  ): Promise<DemoJob | null> {
    await this.ensureSeeded();
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const doc = await this.lockDoc(client, id);
        if (!doc) {
          await client.query("ROLLBACK");
          return null;
        }
        const inflight = doc._inflight;
        // Hand the job (without the reserved field) to a single-job repo.
        const { _inflight, ...job } = doc;
        void _inflight;
        const repo = new InMemoryDemoJobRepository([job as DemoJob]);
        const result = await fn(repo);
        const mutated = repo.peekFirst();
        if (!mutated) {
          await client.query("ROLLBACK");
          return null;
        }
        const nextDoc: StoredDoc = { ...(mutated as StoredDoc) };
        if (inflight) nextDoc._inflight = inflight; // preserve guard flags
        await this.writeDoc(client, nextDoc);
        await client.query("COMMIT");
        return result ? this.clean({ ...(result as StoredDoc) }) : null;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  // -------------------------------------------------------------------------
  // Document mutations (delegate to the in-memory logic)
  // -------------------------------------------------------------------------

  setFeatures(id: string, features: DiscoveredFeature[], meta: FeatureDiscoveryMeta) {
    return this.mutate(id, (r) => r.setFeatures(id, features, meta));
  }
  setFeatureSelection(jobId: string, featureId: string, selected: boolean) {
    return this.mutate(jobId, (r) => r.setFeatureSelection(jobId, featureId, selected));
  }
  setPlan(jobId: string, plan: DemoPlan) {
    return this.mutate(jobId, (r) => r.setPlan(jobId, plan));
  }
  setPlanScenes(jobId: string, scenes: PlanScene[]) {
    return this.mutate(jobId, (r) => r.setPlanScenes(jobId, scenes));
  }
  updatePlanScene(jobId: string, scene: PlanScene) {
    return this.mutate(jobId, (r) => r.updatePlanScene(jobId, scene));
  }
  approvePlan(jobId: string) {
    return this.mutate(jobId, (r) => r.approvePlan(jobId));
  }
  setActionPlan(jobId: string, actionPlan: ActionPlan) {
    return this.mutate(jobId, (r) => r.setActionPlan(jobId, actionPlan));
  }
  setSceneActions(jobId: string, sceneId: string, actions: PlannedBrowserAction[]) {
    return this.mutate(jobId, (r) => r.setSceneActions(jobId, sceneId, actions));
  }
  approveActionPlan(jobId: string) {
    return this.mutate(jobId, (r) => r.approveActionPlan(jobId));
  }
  setStatus(jobId: string, status: DemoStatus) {
    return this.mutate(jobId, (r) => r.setStatus(jobId, status));
  }
  finishRecording(jobId: string, result: RecordingResult) {
    return this.withGuardCleared(jobId, "recording", (r) =>
      r.finishRecording(jobId, result)
    );
  }
  finishVoiceOver(jobId: string, voiceOver: VoiceOver) {
    return this.withGuardCleared(jobId, "voice", (r) =>
      r.finishVoiceOver(jobId, voiceOver)
    );
  }
  updateSceneAudio(jobId: string, audio: SceneAudio) {
    return this.mutate(jobId, (r) => r.updateSceneAudio(jobId, audio));
  }
  setQualityReport(jobId: string, report: QualityReport) {
    return this.mutate(jobId, (r) => r.setQualityReport(jobId, report));
  }
  resolveHumanReview(
    jobId: string,
    sceneId: string,
    actionId: string,
    decision: "RETRY" | "SKIP" | "ABORT"
  ) {
    return this.mutate(jobId, (r) =>
      r.resolveHumanReview(jobId, sceneId, actionId, decision)
    );
  }
  finishRender(jobId: string, render: RenderResult) {
    return this.withGuardCleared(jobId, "render", (r) =>
      r.finishRender(jobId, render)
    );
  }

  // -------------------------------------------------------------------------
  // Duplicate-job guards (atomic, shared via doc._inflight)
  // -------------------------------------------------------------------------

  /**
   * Atomically claim a single-flag guard (recording/voice/render). Returns
   * false if the job is missing or the flag is already set. Also applies the
   * in-memory method's side effects (status/pipeline) via the same delegation.
   */
  private async claimGuard(
    jobId: string,
    flag: "recording" | "voice" | "render",
    apply: (repo: InMemoryDemoJobRepository) => Promise<boolean>
  ): Promise<boolean> {
    await this.ensureSeeded();
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const doc = await this.lockDoc(client, jobId);
        if (!doc) {
          await client.query("ROLLBACK");
          return false;
        }
        const inflight: InFlight = doc._inflight ?? {};
        if (inflight[flag]) {
          await client.query("ROLLBACK");
          return false; // already in flight
        }
        const { _inflight, ...job } = doc;
        void _inflight;
        const repo = new InMemoryDemoJobRepository([job as DemoJob]);
        const ok = await apply(repo);
        if (!ok) {
          await client.query("ROLLBACK");
          return false;
        }
        const mutated = repo.peekFirst()!;
        const nextDoc: StoredDoc = {
          ...(mutated as StoredDoc),
          _inflight: { ...inflight, [flag]: true },
        };
        await this.writeDoc(client, nextDoc);
        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  /** finish* counterpart: apply the mutation and clear the guard flag. */
  private async withGuardCleared(
    jobId: string,
    flag: "recording" | "voice" | "render",
    fn: (repo: InMemoryDemoJobRepository) => Promise<DemoJob | null>
  ): Promise<DemoJob | null> {
    await this.ensureSeeded();
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const doc = await this.lockDoc(client, jobId);
        if (!doc) {
          await client.query("ROLLBACK");
          return null;
        }
        const inflight: InFlight = doc._inflight ?? {};
        const { _inflight, ...job } = doc;
        void _inflight;
        const repo = new InMemoryDemoJobRepository([job as DemoJob]);
        const result = await fn(repo);
        const mutated = repo.peekFirst();
        if (!mutated) {
          await client.query("ROLLBACK");
          return null;
        }
        delete inflight[flag];
        const nextDoc: StoredDoc = { ...(mutated as StoredDoc), _inflight: inflight };
        await this.writeDoc(client, nextDoc);
        await client.query("COMMIT");
        return result ? this.clean({ ...(result as StoredDoc) }) : null;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  tryStartRecording(jobId: string) {
    return this.claimGuard(jobId, "recording", (r) => r.tryStartRecording(jobId));
  }
  tryStartVoice(jobId: string) {
    return this.claimGuard(jobId, "voice", (r) => r.tryStartVoice(jobId));
  }
  tryStartRender(jobId: string) {
    return this.claimGuard(jobId, "render", (r) => r.tryStartRender(jobId));
  }

  async tryStartLanguage(
    jobId: string,
    language: DemoLanguageCode
  ): Promise<boolean> {
    await this.ensureSeeded();
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const doc = await this.lockDoc(client, jobId);
        if (!doc) {
          await client.query("ROLLBACK");
          return false;
        }
        const inflight: InFlight = doc._inflight ?? {};
        const langs = inflight.languages ?? [];
        if (langs.includes(language)) {
          await client.query("ROLLBACK");
          return false;
        }
        const { _inflight, ...job } = doc;
        void _inflight;
        const repo = new InMemoryDemoJobRepository([job as DemoJob]);
        const ok = await repo.tryStartLanguage(jobId, language);
        if (!ok) {
          await client.query("ROLLBACK");
          return false;
        }
        const mutated = repo.peekFirst()!;
        const nextDoc: StoredDoc = {
          ...(mutated as StoredDoc),
          _inflight: { ...inflight, languages: [...langs, language] },
        };
        await this.writeDoc(client, nextDoc);
        await client.query("COMMIT");
        return true;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }

  async upsertLanguageVersion(
    jobId: string,
    version: LanguageVersion
  ): Promise<DemoJob | null> {
    await this.ensureSeeded();
    return withClient(async (client) => {
      await client.query("BEGIN");
      try {
        const doc = await this.lockDoc(client, jobId);
        if (!doc) {
          await client.query("ROLLBACK");
          return null;
        }
        const inflight: InFlight = doc._inflight ?? {};
        const { _inflight, ...job } = doc;
        void _inflight;
        const repo = new InMemoryDemoJobRepository([job as DemoJob]);
        const result = await repo.upsertLanguageVersion(jobId, version);
        const mutated = repo.peekFirst();
        if (!mutated) {
          await client.query("ROLLBACK");
          return null;
        }
        inflight.languages = (inflight.languages ?? []).filter(
          (l) => l !== version.language
        );
        const nextDoc: StoredDoc = { ...(mutated as StoredDoc), _inflight: inflight };
        await this.writeDoc(client, nextDoc);
        await client.query("COMMIT");
        return result ? this.clean({ ...(result as StoredDoc) }) : null;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    });
  }
}
