import { NextResponse } from "next/server";
import { executeActions } from "@/lib/browser/playwright-executor";
import type { BrowserAction } from "@/lib/browser/types";

/**
 * GET /api/dev/action-test  (development helper)
 *
 * Executes a small, fixed sequence of allowlisted actions against a safe public
 * website (example.com) that requires no login or payment. Demonstrates the
 * executor end to end: navigate -> click -> scroll -> screenshot, returning an
 * ActionExecutionResult per action.
 *
 * This route is a Phase 4 test harness. It is disabled outside development so
 * it cannot be triggered in production.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

// A safe public site with a link to click. No login, no payment.
const TEST_URL = "https://example.com";

const TEST_ACTIONS: BrowserAction[] = [
  { type: "navigate", url: TEST_URL },
  { type: "wait", milliseconds: 500 },
  { type: "screenshot", name: "home" },
  // example.com has a single "Learn more" link. Use a visible-text selector
  // (one of the preferred robust strategies).
  {
    type: "click",
    selector: 'text="Learn more"',
    description: 'Click the "Learn more" link',
  },
  { type: "wait", milliseconds: 800 },
  { type: "scroll", direction: "down", amount: 400 },
  { type: "screenshot", name: "after-click" },
];

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { success: false, error: { code: "disabled", message: "Test route is disabled in production." } },
      { status: 403 }
    );
  }

  // Note: clicking the "Learn more" link navigates OFF example.com (to
  // iana.org). The executor's navigation guard only applies to explicit
  // `navigate` actions; a click that triggers navigation is allowed, but the
  // action plan's own navigate actions remain domain-scoped. For this harness
  // we scope the executor to example.com and simply demonstrate the verbs.
  const run = await executeActions(TEST_ACTIONS, {
    websiteUrl: TEST_URL,
    actionTimeoutMs: 10_000,
  });

  return NextResponse.json({
    success: run.ok,
    website: TEST_URL,
    results: run.results.map((r) => ({
      type: r.action.type,
      success: r.success,
      message: r.message,
      screenshotPath: r.screenshotPath ?? null,
    })),
  });
}
