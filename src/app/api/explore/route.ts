import { NextResponse } from "next/server";
import { z } from "zod";
import { exploreWebsite } from "@/lib/browser/browser-explorer";
import { ExplorerError, type ExplorerErrorCode } from "@/lib/browser/types";

/**
 * POST /api/explore
 *
 * Request:  { "url": "https://example.com" }
 * Response: { "success": true, "data": WebsiteExploration }
 *        or { "success": false, "error": { "code", "message" } }
 *
 * This route runs the Playwright explorer, which needs the Node.js runtime
 * (not Edge) and can take tens of seconds.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const requestSchema = z.object({
  url: z.string().min(1, "A URL is required."),
});

/** Map explorer error categories to HTTP status codes. */
const STATUS_BY_CODE: Record<ExplorerErrorCode, number> = {
  invalid_url: 400,
  blocked_url: 400,
  http_error: 502,
  unreachable: 502,
  timeout: 504,
  browser_error: 500,
};

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: { code: "invalid_url", message: "Request body must be JSON." },
      },
      { status: 400 }
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "invalid_url",
          message: parsed.error.issues[0]?.message ?? "Invalid request.",
        },
      },
      { status: 400 }
    );
  }

  try {
    const data = await exploreWebsite(parsed.data.url);
    return NextResponse.json({ success: true, data });
  } catch (err) {
    if (err instanceof ExplorerError) {
      return NextResponse.json(
        { success: false, error: { code: err.code, message: err.message } },
        { status: STATUS_BY_CODE[err.code] }
      );
    }
    // Unexpected error: do not leak internals.
    console.error("Unexpected /api/explore error:", err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "browser_error",
          message: "An unexpected error occurred while exploring the website.",
        },
      },
      { status: 500 }
    );
  }
}
