import type { Page } from "playwright";
import type {
  BrowserAction,
  ExpectedState,
  PageState,
  VerificationResult,
  VerificationStatus,
  ActionVerification,
  VerifiedOutcome,
  HumanReviewContext,
} from "./types";
import { summarize } from "./action-planner";

/**
 * Phase 9 — AI-Assisted Browser Quality Control verification engine.
 *
 * Verification order (cheapest-first, most-expensive-last):
 *   1. Rule-based checks (URL, title, visible text, DOM). Fast, free, no AI.
 *   2. Vision model (only when rule check is UNCERTAIN or fails). Bounded.
 *
 * SECURITY: The vision model ONLY returns PASS / FAIL / UNCERTAIN + text. It
 * cannot trigger Playwright. The Playwright executor is the sole component
 * allowed to run browser actions (unchanged from Phase 4).
 *
 * Retry loop: maximum MAX_RETRIES safe recovery actions before flagging for
 * human review.
 */

const MAX_RETRIES = 2;
/** Actions whose result is meaningful to verify (interactive + navigation). */
const VERIFIABLE_TYPES = new Set(["navigate", "click", "fill", "select"]);

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Page state capture
// ---------------------------------------------------------------------------

export async function capturePageState(
  page: Page,
  screenshotDir?: string,
  name?: string
): Promise<PageState> {
  const url = page.url();
  const title = await page.title().catch(() => "");

  // Capture up to 4 KB of visible body text.
  const visibleText = await page
    .evaluate(() => {
      const el = document.body;
      return el ? (el.innerText ?? "").slice(0, 4096) : "";
    })
    .catch(() => "");

  let screenshotBase64: string | null = null;
  let screenshotPath: string | null = null;

  try {
    const buf = await page.screenshot({ fullPage: false });
    screenshotBase64 = buf.toString("base64");
    if (screenshotDir && name) {
      const { promises: fs } = await import("node:fs");
      const path = await import("node:path");
      await fs.mkdir(screenshotDir, { recursive: true });
      const absPath = path.join(screenshotDir, `${name}.png`);
      await fs.writeFile(absPath, buf);
      screenshotPath = "/" + absPath.split("\\").join("/").replace(/^.*\/public\//, "public/");
    }
  } catch {
    /* screenshot is best-effort */
  }

  return {
    url,
    title,
    visibleText,
    screenshotBase64,
    screenshotPath,
    capturedAt: nowIso(),
  };
}

// ---------------------------------------------------------------------------
// Rule-based fast-path check (no AI, no cost)
// ---------------------------------------------------------------------------

function ruleCheck(
  state: PageState,
  expected: ExpectedState
): VerificationResult {
  // Visible-text check: every expected string must appear in the page body.
  if (expected.visibleText && expected.visibleText.length > 0) {
    const bodyLower = state.visibleText.toLowerCase();
    const missing = expected.visibleText.filter(
      (t) => !bodyLower.includes(t.toLowerCase())
    );
    if (missing.length === 0) {
      return {
        status: "PASS",
        reason: `All expected text found: ${expected.visibleText.join(", ")}`,
        evidence: expected.visibleText.join(", "),
        checkType: "rule",
      };
    }
    if (missing.length === expected.visibleText.length) {
      return {
        status: "FAIL",
        reason: `None of the expected text found. Missing: ${missing.join(", ")}`,
        evidence: `Page title: "${state.title}", URL: ${state.url}`,
        checkType: "rule",
      };
    }
    // Partial match → UNCERTAIN, let vision decide.
    return {
      status: "UNCERTAIN",
      reason: `Partial text match. Missing: ${missing.join(", ")}`,
      evidence: `Found some but not all expected text on "${state.title}"`,
      checkType: "rule",
    };
  }

  // No text criteria — only a description is provided. Rule check cannot
  // resolve this without seeing the screenshot, so we hand off to vision.
  return {
    status: "UNCERTAIN",
    reason: "No text criteria; visual check required.",
    evidence: `URL: ${state.url}, title: "${state.title}"`,
    checkType: "rule",
  };
}

// ---------------------------------------------------------------------------
// Vision model check (Bedrock Converse; only called when rule check is not
// conclusive)
// ---------------------------------------------------------------------------

const VISION_MODEL_ID =
  process.env.BEDROCK_MODEL_ID ?? "us.anthropic.claude-sonnet-4-6";
const VISION_MAX_TOKENS = 512;

const VISION_SYSTEM_PROMPT = `You are a UI verification assistant for AutoDemo.

You will be shown a screenshot of a web page and asked whether it matches an expected state.

STRICT RULES:
1. Return ONLY one of: PASS, FAIL, or UNCERTAIN.
2. PASS: the screenshot clearly shows the expected state.
3. FAIL: the screenshot clearly does NOT show the expected state.
4. UNCERTAIN: you cannot determine from the screenshot alone.
5. You may NOT suggest clicking, navigating, or any other browser action.
6. Your output must be a JSON object with three string keys: status, reason, evidence.

Example: {"status":"PASS","reason":"The product page heading is visible","evidence":"H1 text 'Product Details' is present"}`;

async function visionCheck(
  state: PageState,
  expected: ExpectedState
): Promise<VerificationResult> {
  if (!state.screenshotBase64) {
    return {
      status: "UNCERTAIN",
      reason: "No screenshot available for vision check.",
      evidence: `URL: ${state.url}`,
      checkType: "vision",
    };
  }

  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "";
  if (!region && process.env.AUTODEMO_AI_PROVIDER?.toLowerCase() !== "bedrock") {
    // No cloud configured; fall back to a conservative UNCERTAIN.
    return {
      status: "UNCERTAIN",
      reason: "Vision model unavailable (no AWS region configured).",
      evidence: `URL: ${state.url}, title: "${state.title}"`,
      checkType: "vision",
    };
  }

  const userText = [
    `Expected state: ${expected.description}`,
    `Current URL: ${state.url}`,
    `Current page title: ${state.title}`,
    "",
    "Does the screenshot show the expected state? Reply with JSON only.",
  ].join("\n");

  try {
    const { BedrockRuntimeClient, ConverseCommand } = await import(
      "@aws-sdk/client-bedrock-runtime"
    );
    const client = new BedrockRuntimeClient({
      region: region || "us-east-1",
      maxAttempts: 3,
      retryMode: "adaptive",
    });

    const response = await client.send(
      new ConverseCommand({
        modelId: VISION_MODEL_ID,
        system: [{ text: VISION_SYSTEM_PROMPT }],
        messages: [
          {
            role: "user",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            content: [
              { text: userText },
              {
                image: {
                  format: "png",
                  source: {
                    bytes: new Uint8Array(
                      Buffer.from(state.screenshotBase64, "base64")
                    ),
                  },
                },
              },
            ] as any,
          },
        ],
        inferenceConfig: { maxTokens: VISION_MAX_TOKENS, temperature: 0 },
      })
    );

    const raw =
      response.output?.message?.content?.find((b) => b.text)?.text ?? "";

    // Parse the model's JSON response — the model may only return PASS/FAIL/UNCERTAIN.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        status?: string;
        reason?: string;
        evidence?: string;
      };
      const status = (parsed.status ?? "UNCERTAIN").toUpperCase();
      if (status === "PASS" || status === "FAIL" || status === "UNCERTAIN") {
        return {
          status: status as VerificationStatus,
          reason: String(parsed.reason ?? ""),
          evidence: String(parsed.evidence ?? ""),
          checkType: "vision",
        };
      }
    }
    return {
      status: "UNCERTAIN",
      reason: "Model returned an unrecognized format.",
      evidence: raw.slice(0, 200),
      checkType: "vision",
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: "UNCERTAIN",
      reason: `Vision check failed: ${message}`,
      evidence: `URL: ${state.url}`,
      checkType: "vision",
    };
  }
}

// ---------------------------------------------------------------------------
// Recovery helpers (safe, passive — no executor calls)
// ---------------------------------------------------------------------------

async function safeRecoveryWait(page: Page, ms = 1200): Promise<void> {
  await page.waitForTimeout(ms).catch(() => undefined);
}

async function safeRecoveryScroll(page: Page): Promise<void> {
  await page.mouse.wheel(0, 200).catch(() => undefined);
  await page.waitForTimeout(300).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Main verification loop
// ---------------------------------------------------------------------------

export interface VerifyOptions {
  sceneId: string;
  screenshotDir?: string;
  screenshotPrefix?: string;
}

/**
 * Run the full verification loop for one action:
 *   1. Capture page state.
 *   2. Rule check (fast, free).
 *   3. If UNCERTAIN: vision check.
 *   4. If FAIL: up to MAX_RETRIES recovery attempts, each followed by re-check.
 *   5. If still failing: flag for human review.
 *
 * Returns an ActionVerification record. The caller (recorder) decides whether
 * to continue, halt, or gate rendering based on the outcome.
 *
 * This function NEVER calls executeSingleAction / any Playwright executor method
 * that drives the page. Recovery is limited to passive waits and scrolls, which
 * don't change application state.
 */
export async function verifyAction(
  page: Page,
  action: BrowserAction,
  expected: ExpectedState,
  opts: VerifyOptions
): Promise<ActionVerification> {
  let visionModelUsed = false;
  let retryCount = 0;

  async function attemptCheck(attempt: number): Promise<VerificationResult> {
    const prefix = `${opts.screenshotPrefix ?? "verify"}-attempt${attempt}`;
    const state = await capturePageState(page, opts.screenshotDir, prefix);

    // Rule-based check first.
    let result = ruleCheck(state, expected);
    if (result.status !== "UNCERTAIN") return result;

    // Rule inconclusive: escalate to vision (cost-controlled).
    visionModelUsed = true;
    result = await visionCheck(state, expected);
    return result;
  }

  // Initial check.
  let result = await attemptCheck(0);

  while (result.status === "FAIL" && retryCount < MAX_RETRIES) {
    retryCount++;
    // Passive recovery: wait, then a gentle scroll to let the page settle.
    await safeRecoveryWait(page);
    if (retryCount > 1) await safeRecoveryScroll(page);
    result = await attemptCheck(retryCount);
  }

  // Capture final page state for the result record.
  const finalState = await capturePageState(
    page,
    opts.screenshotDir,
    `${opts.screenshotPrefix ?? "verify"}-final`
  ).catch(() => null);

  let outcome: VerifiedOutcome;
  let humanReview: HumanReviewContext | undefined;

  if (result.status === "PASS") {
    outcome = retryCount > 0 ? "RETRIED_PASS" : "PASS";
  } else {
    // FAIL or UNCERTAIN after retries → human review required.
    outcome = "HUMAN_REVIEW";
    humanReview = {
      sceneId: opts.sceneId,
      actionSummary: summarize(action),
      expectedState: expected,
      actualState: finalState,
      failReason: result.reason,
      screenshotPath: finalState?.screenshotPath ?? null,
    };
  }

  return {
    outcome,
    retryCount,
    pageState: finalState,
    verificationResult: result,
    visionModelUsed,
    humanReview,
  };
}

/**
 * Determine whether a given BrowserAction type warrants a verification check.
 * Scroll, wait, hover, press, and screenshot actions have no meaningful
 * expected "page state" change worth verifying.
 */
export function isVerifiableActionType(type: BrowserAction["type"]): boolean {
  return VERIFIABLE_TYPES.has(type);
}
