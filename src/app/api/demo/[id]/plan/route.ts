import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { generatePlan, AiError } from "@/lib/planner/demo-planner";
import type { PlanScene } from "@/types";

/**
 * /api/demo/[id]/plan
 *
 * POST  — generate a fresh storyboard from the job's discovered features.
 * PUT   — replace the storyboard's scenes (used for edit narration, reorder,
 *         and remove). Any structural change resets the plan to "draft".
 *
 * Needs the Node runtime (AWS SDK) and can take tens of seconds.
 */
export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = getRepository();
  const job = await repo.getById(id);
  if (!job) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "Demo not found." } },
      { status: 404 }
    );
  }

  try {
    const plan = await generatePlan(job);
    const updated = await repo.setPlan(id, plan);
    return NextResponse.json({
      success: true,
      data: { plan: updated?.plan ?? plan },
    });
  } catch (err) {
    return handlePlanError(err);
  }
}

// Scene edits accepted from the client. Server preserves id/featureId and
// re-derives order; it does not trust client-supplied order.
const sceneEditSchema = z.object({
  id: z.string().min(1),
  featureId: z.string().min(1),
  title: z.string().min(1).max(200),
  objective: z.string().max(600),
  narration: z.string().min(1).max(4000),
  estimatedDuration: z.number().min(1).max(600),
  evidence: z.array(z.string()).max(20),
});

const putSchema = z.object({
  scenes: z.array(sceneEditSchema).max(20),
});

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const repo = getRepository();
  const job = await repo.getById(id);
  if (!job || !job.plan) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "No storyboard to update." } },
      { status: 404 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "invalid_request", message: "Body must be JSON." } },
      { status: 400 }
    );
  }

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "Invalid request.",
        },
      },
      { status: 400 }
    );
  }

  // Merge edits onto existing scenes, keeping actions (not client-editable).
  const existing = new Map(job.plan.scenes.map((s) => [s.id, s]));
  const scenes: PlanScene[] = parsed.data.scenes.map((edit) => {
    const prev = existing.get(edit.id);
    return {
      id: edit.id,
      order: 0, // repository re-numbers
      featureId: edit.featureId,
      title: edit.title,
      objective: edit.objective,
      narration: edit.narration,
      estimatedDuration: edit.estimatedDuration,
      actions: prev?.actions ?? [],
      evidence: edit.evidence,
    };
  });

  const updated = await repo.setPlanScenes(id, scenes);
  return NextResponse.json({ success: true, data: { plan: updated?.plan } });
}

function handlePlanError(err: unknown) {
  if (err instanceof AiError) {
    const status = err.code === "config" ? 400 : 502;
    return NextResponse.json(
      { success: false, error: { code: err.code, message: err.message } },
      { status }
    );
  }
  console.error("Unexpected /plan error:", err);
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "internal_error",
        message: "An unexpected error occurred while planning the demo.",
      },
    },
    { status: 500 }
  );
}
