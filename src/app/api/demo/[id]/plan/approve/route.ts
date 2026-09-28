import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";

/**
 * POST /api/demo/[id]/plan/approve
 *
 * Approves the storyboard. The recording stage must not begin until the plan
 * is approved; approving completes the demo_planning pipeline stage.
 */
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const updated = await getRepository().approvePlan(id);
  if (!updated) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "not_found",
          message: "No storyboard to approve, or it has no scenes.",
        },
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, data: { plan: updated.plan } });
}
