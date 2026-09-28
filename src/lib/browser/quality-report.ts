import type {
  QualityReport,
  SceneQualityReport,
  ActionQualityItem,
  ActionVerification,
  VerifiedOutcome,
} from "./types";
import type { SceneActionSet } from "./types";

/**
 * Phase 9 QualityReport aggregation.
 *
 * Given a map of actionId→ActionVerification for each scene, produces the full
 * QualityReport that surfaces in the dashboard and gates rendering.
 *
 * Rendering is blocked when any action is HUMAN_REVIEW (the user must decide
 * before the final video can be created).
 */

type VerificationMap = Map<
  string,
  { verification: ActionVerification; actionId: string; summary: string }
>;

export function buildQualityReport(
  jobId: string,
  scenes: SceneActionSet[],
  verificationsByScene: Map<string, VerificationMap>
): QualityReport {
  const sceneReports: SceneQualityReport[] = [];
  let totalActions = 0;
  let passedActions = 0;
  let failedActions = 0;
  let retriedActions = 0;
  let skippedActions = 0;
  let humanReviewActions = 0;
  let verifiedActions = 0;
  let visionModelCallCount = 0;

  for (const scene of scenes) {
    const vMap = verificationsByScene.get(scene.sceneId) ?? new Map();
    const actionItems: ActionQualityItem[] = [];

    for (const pa of scene.actions) {
      totalActions++;
      const entry = vMap.get(pa.id);
      const outcome: VerifiedOutcome = entry?.verification.outcome ?? "NO_CHECK";

      switch (outcome) {
        case "PASS":
        case "RETRIED_PASS":
          passedActions++;
          verifiedActions++;
          if (outcome === "RETRIED_PASS") retriedActions++;
          break;
        case "FAIL":
          failedActions++;
          verifiedActions++;
          break;
        case "HUMAN_REVIEW":
          humanReviewActions++;
          verifiedActions++;
          break;
        case "SKIPPED_BY_USER":
          skippedActions++;
          verifiedActions++;
          break;
        default:
          // NO_CHECK — not counted in verifiedActions
          break;
      }

      if (entry?.verification.visionModelUsed) visionModelCallCount++;

      actionItems.push({
        actionId: pa.id,
        summary: entry?.summary ?? pa.summary,
        outcome,
        retryCount: entry?.verification.retryCount ?? 0,
        visionModelUsed: entry?.verification.visionModelUsed ?? false,
        screenshotPath:
          entry?.verification.pageState?.screenshotPath ?? null,
        failReason:
          outcome === "FAIL" || outcome === "HUMAN_REVIEW"
            ? entry?.verification.verificationResult?.reason
            : undefined,
        humanReview: entry?.verification.humanReview,
      });
    }

    const scenePass = actionItems.filter(
      (a) => a.outcome === "PASS" || a.outcome === "RETRIED_PASS"
    ).length;
    const sceneFail = actionItems.filter((a) => a.outcome === "FAIL").length;
    const sceneReview = actionItems.filter(
      (a) => a.outcome === "HUMAN_REVIEW"
    ).length;

    sceneReports.push({
      sceneId: scene.sceneId,
      title: scene.title,
      totalActions: scene.actions.length,
      passedActions: scenePass,
      failedActions: sceneFail,
      humanReviewActions: sceneReview,
      actions: actionItems,
    });
  }

  return {
    jobId,
    totalActions,
    passedActions,
    failedActions,
    retriedActions,
    skippedActions,
    humanReviewActions,
    verifiedActions,
    verificationRate: totalActions > 0 ? verifiedActions / totalActions : 0,
    visionModelCallCount,
    blocksRendering: humanReviewActions > 0,
    generatedAt: new Date().toISOString(),
    sceneReports,
  };
}

/**
 * Apply a human review decision to an ActionVerification in-place.
 * Returns the updated outcome.
 */
export function applyHumanDecision(
  verification: ActionVerification,
  decision: "RETRY" | "SKIP" | "ABORT"
): VerifiedOutcome {
  if (!verification.humanReview) return verification.outcome;
  verification.humanReview.decision = decision;
  verification.humanReview.decidedAt = new Date().toISOString();
  if (decision === "SKIP") {
    verification.outcome = "SKIPPED_BY_USER";
  }
  return verification.outcome;
}
