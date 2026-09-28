import type { DemoJob, DemoSettings } from "@/types";
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
