import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";

/**
 * POST /api/demo/[id]/actions/approve
 *
 * Approves the Phase 4 browser action plan. (Recording, a later phase, must
 * not begin until the action plan is approved.)
 */
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const updated = await getRepository().approveActionPlan(id);
  if (!updated) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "not_found",
          message: "No browser action plan to approve, or it has no actions.",
        },
      },
      { status: 404 }
    );
  }
  return NextResponse.json({ success: true, actionPlan: updated.actionPlan });
}
