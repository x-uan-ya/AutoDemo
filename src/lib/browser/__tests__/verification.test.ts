import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ruleCheck,
  resolveOutcome,
  isVerifiableActionType,
  MAX_VERIFICATION_RETRIES,
} from "../verification";
import {
  buildQualityReport,
  applyHumanDecision,
} from "../quality-report";
import type {
  PageState,
  ExpectedState,
  ActionVerification,
  SceneActionSet,
} from "../types";

/**
 * Phase 9 verification tests. These exercise the pure, deterministic pieces of
 * the quality-control system (rule check, retry/outcome state machine, report
 * aggregation, human decisions) without needing a live browser or AI.
 *
 * Run: npx tsx --test src/lib/browser/__tests__/verification.test.ts
 */

function makeState(partial: Partial<PageState> = {}): PageState {
  return {
    url: "https://example.com/products",
    title: "Products",
    visibleText: "Product Details\nAdd to Cart\nPrice $9.99",
    screenshotBase64: null,
    screenshotPath: null,
    capturedAt: new Date().toISOString(),
    ...partial,
  };
}

// --- Scenario 1: successful click (expected text present) -> rule PASS -------
test("successful click: rule check PASS when expected text is present", () => {
  const expected: ExpectedState = {
    description: "Product page should be visible",
    visibleText: ["Product Details"],
  };
  const result = ruleCheck(makeState(), expected);
  assert.equal(result.status, "PASS");
  assert.equal(result.checkType, "rule");
});

// --- Scenario 2: wrong selector / expected text entirely absent -> FAIL ------
test("wrong result: rule check FAIL when none of the expected text is present", () => {
  const expected: ExpectedState = {
    description: "Checkout page should be visible",
    visibleText: ["Order Confirmation", "Payment Successful"],
  };
  const result = ruleCheck(makeState(), expected);
  assert.equal(result.status, "FAIL");
});

// --- Scenario 3: page did not change (partial match) -> UNCERTAIN ------------
test("page did not change: partial text match -> UNCERTAIN (escalates to vision)", () => {
  const expected: ExpectedState = {
    description: "Cart page",
    visibleText: ["Product Details", "Shopping Cart Total"],
  };
  const result = ruleCheck(makeState(), expected);
  assert.equal(result.status, "UNCERTAIN");
});

// --- Scenario 4: unexpected page (no text criteria) -> UNCERTAIN -------------
test("unexpected page: description-only expectation -> UNCERTAIN (needs vision)", () => {
  const expected: ExpectedState = {
    description: "A pricing table should be visible",
  };
  const result = ruleCheck(makeState({ title: "Home" }), expected);
  assert.equal(result.status, "UNCERTAIN");
  assert.equal(result.checkType, "rule");
});

// --- Scenario 5: retry -> RETRIED_PASS ---------------------------------------
test("retry: a PASS after one or more retries resolves to RETRIED_PASS", () => {
  assert.equal(resolveOutcome("PASS", 0), "PASS");
  assert.equal(resolveOutcome("PASS", 1), "RETRIED_PASS");
  assert.equal(resolveOutcome("PASS", 2), "RETRIED_PASS");
  // Retry cap is 2.
  assert.equal(MAX_VERIFICATION_RETRIES, 2);
});

// --- Scenario 6: human review -> HUMAN_REVIEW when still failing --------------
test("human review: FAIL/UNCERTAIN after retries resolves to HUMAN_REVIEW", () => {
  assert.equal(resolveOutcome("FAIL", 2), "HUMAN_REVIEW");
  assert.equal(resolveOutcome("UNCERTAIN", 2), "HUMAN_REVIEW");
});

// --- Scenario 7: successful verification report + human decision -------------
test("successful verification: quality report aggregates outcomes correctly", () => {
  const scenes: SceneActionSet[] = [
    {
      sceneId: "s1",
      order: 1,
      title: "Scene 1",
      actions: [
        { id: "a1", action: { type: "navigate", url: "https://example.com" }, summary: "Navigate", requiresHumanApproval: false },
        { id: "a2", action: { type: "click", selector: "role=button", description: "Open" }, summary: "Click Open", requiresHumanApproval: false },
        { id: "a3", action: { type: "scroll", direction: "down" }, summary: "Scroll down", requiresHumanApproval: false },
      ],
    },
  ];

  const vPass: ActionVerification = {
    outcome: "PASS", retryCount: 0, pageState: null,
    verificationResult: { status: "PASS", reason: "ok", evidence: "", checkType: "rule" },
    visionModelUsed: false,
  };
  const vRetried: ActionVerification = {
    outcome: "RETRIED_PASS", retryCount: 1, pageState: null,
    verificationResult: { status: "PASS", reason: "ok after retry", evidence: "", checkType: "vision" },
    visionModelUsed: true,
  };

  const verificationsByScene = new Map([
    ["s1", new Map([
      ["a1", { verification: vPass, actionId: "a1", summary: "Navigate" }],
      ["a2", { verification: vRetried, actionId: "a2", summary: "Click Open" }],
      // a3 (scroll) has no verification -> NO_CHECK
    ])],
  ]);

  const report = buildQualityReport("job1", scenes, verificationsByScene);
  assert.equal(report.totalActions, 3);
  assert.equal(report.passedActions, 2);     // a1 PASS + a2 RETRIED_PASS
  assert.equal(report.retriedActions, 1);    // a2
  assert.equal(report.failedActions, 0);
  assert.equal(report.humanReviewActions, 0);
  assert.equal(report.verifiedActions, 2);   // a3 is NO_CHECK
  assert.equal(report.visionModelCallCount, 1);
  assert.equal(report.blocksRendering, false);
});

test("human review: report blocks rendering until resolved; SKIP clears it", () => {
  const scenes: SceneActionSet[] = [
    {
      sceneId: "s1", order: 1, title: "Scene 1",
      actions: [
        { id: "a1", action: { type: "click", selector: "role=button", description: "Open" }, summary: "Click Open", requiresHumanApproval: false },
      ],
    },
  ];
  const vReview: ActionVerification = {
    outcome: "HUMAN_REVIEW", retryCount: 2, pageState: null,
    verificationResult: { status: "FAIL", reason: "page unchanged", evidence: "", checkType: "vision" },
    visionModelUsed: true,
    humanReview: {
      sceneId: "s1",
      actionSummary: "Click Open",
      expectedState: { description: "Product page", visibleText: ["Product Details"] },
      actualState: null,
      failReason: "page unchanged",
      screenshotPath: null,
    },
  };
  const verificationsByScene = new Map([
    ["s1", new Map([["a1", { verification: vReview, actionId: "a1", summary: "Click Open" }]])],
  ]);

  const report = buildQualityReport("job1", scenes, verificationsByScene);
  assert.equal(report.humanReviewActions, 1);
  assert.equal(report.blocksRendering, true);

  // Applying a SKIP decision flips the outcome to SKIPPED_BY_USER.
  const outcome = applyHumanDecision(vReview, "SKIP");
  assert.equal(outcome, "SKIPPED_BY_USER");
  assert.equal(vReview.humanReview?.decision, "SKIP");
});

// --- Verifiable action types -------------------------------------------------
test("only interactive/navigation actions are verifiable", () => {
  assert.equal(isVerifiableActionType("click"), true);
  assert.equal(isVerifiableActionType("navigate"), true);
  assert.equal(isVerifiableActionType("fill"), true);
  assert.equal(isVerifiableActionType("select"), true);
  assert.equal(isVerifiableActionType("scroll"), false);
  assert.equal(isVerifiableActionType("wait"), false);
  assert.equal(isVerifiableActionType("hover"), false);
  assert.equal(isVerifiableActionType("press"), false);
  assert.equal(isVerifiableActionType("screenshot"), false);
});
