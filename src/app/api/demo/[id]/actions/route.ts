import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/repository";
import {
  generateActionPlan,
  ActionPlannerError,
  summarize,
} from "@/lib/browser/action-planner";
import { browserActionSchema } from "@/lib/browser/schemas";
import { flagDestructiveAction } from "@/lib/browser/action-security";
import type { PlannedBrowserAction } from "@/lib/browser/types";

/**
 * /api/demo/[id]/actions
 *
 * POST — generate the Phase 4 browser action plan from the approved storyboard.
 *        Request body may be empty or { "demoId": string }.
 *        Response: { success: true, scenes: SceneActionSet[] } (plus full plan).
 *
 * PUT  — replace the actions of a single scene (edit / delete / reorder).
 *        Body: { sceneId, actions: BrowserAction[] }.
 *
 * Runs server-side (Node runtime). Generation is deterministic and fast, but
 * kept on the Node runtime since it shares the browser libs.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const postSchema = z
  .object({ demoId: z.string().optional() })
  .optional();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Body is optional; validate if present.
  try {
    const text = await request.text();
    if (text.trim().length > 0) {
      const parsed = postSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: { code: "invalid_request", message: "Invalid request body." },
          },
          { status: 400 }
        );
      }
    }
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "invalid_request", message: "Body must be JSON." } },
      { status: 400 }
    );
  }

  const repo = getRepository();
  const job = await repo.getById(id);
  if (!job) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "Demo not found." } },
      { status: 404 }
    );
  }

  try {
    const actionPlan = generateActionPlan(job);
    const updated = await repo.setActionPlan(id, actionPlan);
    const plan = updated?.actionPlan ?? actionPlan;
    return NextResponse.json({
      success: true,
      scenes: plan.scenes,
      actionPlan: plan,
    });
  } catch (err) {
    if (err instanceof ActionPlannerError) {
      return NextResponse.json(
        { success: false, error: { code: "not_ready", message: err.message } },
        { status: 409 }
      );
    }
    console.error("Unexpected /actions error:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "internal_error",
          message: "An unexpected error occurred generating browser actions.",
        },
      },
      { status: 500 }
    );
  }
}

// Scene action edits from the client. The raw action must pass the strict
// allowlist schema; the server re-derives id / summary / flag (never trusts
// client-supplied safety metadata).
const putSchema = z.object({
  sceneId: z.string().min(1),
  actions: z.array(browserActionSchema).max(50),
});

export async function PUT(
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

  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "invalid_request",
          message: parsed.error.issues[0]?.message ?? "Invalid action.",
        },
      },
      { status: 400 }
    );
  }

  // Re-wrap each validated action with server-derived metadata.
  const planned: PlannedBrowserAction[] = parsed.data.actions.map((action) => {
    const reason = flagDestructiveAction(action);
    return {
      id: "act_" + Math.random().toString(36).slice(2, 10),
      action,
      summary: summarize(action),
      requiresHumanApproval: reason != null,
      approvalReason: reason ?? undefined,
    };
  });

  const updated = await getRepository().setSceneActions(
    id,
    parsed.data.sceneId,
    planned
  );
  if (!updated) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "Demo, action plan, or scene not found." } },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    scenes: updated.actionPlan?.scenes ?? [],
    actionPlan: updated.actionPlan,
  });
}
