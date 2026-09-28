import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/repository";
import { buildQualityReport } from "@/lib/browser/quality-report";

/**
 * /api/demo/[id]/quality-check
 *
 * POST — generate (or regenerate) the quality report from the existing recording.
 *        Reads the verifications stored in job.recording.verifications and
 *        aggregates them into a QualityReport stored on the job.
 *
 * PATCH — record a human review decision for one flagged action.
 *         Body: { sceneId, actionId, decision: "RETRY"|"SKIP"|"ABORT" }
 */
export const runtime = "nodejs";

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

  if (!job.recording) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "no_recording", message: "Run a recording first." },
      },
      { status: 409 }
    );
  }

  if (!job.actionPlan || job.actionPlan.scenes.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "no_action_plan", message: "No browser action plan exists." },
      },
      { status: 409 }
    );
  }

  // Build the verification map from the recording result.
  const raw = job.recording.verifications ?? {};
  const verificationsByScene = new Map(
    job.actionPlan.scenes.map((scene) => {
      const sceneVerifs = raw[scene.sceneId] ?? {};
      const vMap = new Map(
        scene.actions.map((pa) => [
          pa.id,
          {
            verification: sceneVerifs[pa.id] ?? {
              outcome: "NO_CHECK" as const,
              retryCount: 0,
              pageState: null,
              verificationResult: null,
              visionModelUsed: false,
            },
            actionId: pa.id,
            summary: pa.summary,
          },
        ])
      );
      return [scene.sceneId, vMap] as const;
    })
  );

  const report = buildQualityReport(id, job.actionPlan.scenes, verificationsByScene);
  await repo.setQualityReport(id, report);

  return NextResponse.json({ success: true, qualityReport: report });
}

const patchSchema = z.object({
  sceneId: z.string().min(1),
  actionId: z.string().min(1),
  decision: z.enum(["RETRY", "SKIP", "ABORT"]),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "invalid_request", message: "Body must be JSON." } },
      { status: 400 }
    );
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "invalid_request", message: parsed.error.issues[0]?.message ?? "Invalid." },
      },
      { status: 400 }
    );
  }

  const { sceneId, actionId, decision } = parsed.data;
  const updated = await getRepository().resolveHumanReview(
    id,
    sceneId,
    actionId,
    decision
  );

  if (!updated) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "Job or action not found." } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    qualityReport: updated.qualityReport,
    blocksRendering: updated.qualityReport?.blocksRendering ?? false,
  });
}
