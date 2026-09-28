import { NextResponse } from "next/server";
import { z } from "zod";
import { getRepository } from "@/lib/repository";

/**
 * PATCH /api/demo/[id]/features
 *
 * Updates the selection state of a single discovered feature.
 * Request: { "featureId": "feat_...", "selected": true }
 */
export const runtime = "nodejs";

const bodySchema = z.object({
  featureId: z.string().min(1),
  selected: z.boolean(),
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

  const parsed = bodySchema.safeParse(body);
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

  const updated = await getRepository().setFeatureSelection(
    id,
    parsed.data.featureId,
    parsed.data.selected
  );

  if (!updated) {
    return NextResponse.json(
      { success: false, error: { code: "not_found", message: "Demo or feature not found." } },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true, data: { features: updated.features } });
}
