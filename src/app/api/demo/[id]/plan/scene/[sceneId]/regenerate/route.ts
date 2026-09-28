import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { regenerateScene, AiError } from "@/lib/planner/demo-planner";

/**
 * POST /api/demo/[id]/plan/scene/[sceneId]/regenerate
 *
 * Regenerates narration/objective for a single scene, keeping its position and
 * feature. Optional { "guidance": "..." } steers the rewrite. Regenerating
 * resets the plan to "draft".
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  guidance: z.string().max(500).optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; sceneId: string }> }
) {
  const { id, sceneId } = await params;
  const repo = getRepository();
  const job = await repo.getById(id);
  if (!job || !job.plan) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "No storyboard found." } },
      { status: 404 }
    );
  }

  const scene = job.plan.scenes.find((s) => s.id === sceneId);
  if (!scene) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "Scene not found." } },
      { status: 404 }
    );
  }

  let guidance: string | undefined;
  try {
    const raw = await request.json();
    const parsed = bodySchema.safeParse(raw);
    if (parsed.success) guidance = parsed.data.guidance;
  } catch {
    // No body is fine; regenerate without guidance.
  }

  try {
    const regenerated = await regenerateScene(job, scene, guidance);
    const updated = await repo.updatePlanScene(id, regenerated);
    return NextResponse.json({
      success: true,
      data: { plan: updated?.plan },
    });
  } catch (err) {
    if (err instanceof AiError) {
      const status = err.code === "config" ? 400 : 502;
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status }
      );
    }
    console.error("Unexpected /regenerate error:", err);
    return NextResponse.json(
      {
        success: false,
        error: { code: "internal_error", message: "Scene regeneration failed." },
      },
      { status: 500 }
    );
  }
}
