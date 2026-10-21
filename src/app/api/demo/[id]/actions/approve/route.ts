import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";
import { guardDemoRoute } from "@/lib/security/route-guard";

/**
 * POST /api/demo/[id]/actions/approve
 *
 * Approves the Phase 4 browser action plan. (Recording, a later phase, must
 * not begin until the action plan is approved.)
 */
export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Auth + CSRF + ownership before approving.
  const guard = await guardDemoRoute(request, id, "default", "/api/demo/[id]/actions/approve");
  if (guard.response) return guard.response;

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
