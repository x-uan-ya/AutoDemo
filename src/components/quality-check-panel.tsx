"use client";

import { useState } from "react";
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  SkipForward,
  XCircle,
  Eye,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QualityReport, ActionQualityItem, HumanReviewContext } from "@/types";

interface ApiError { code: string; message: string; }

/**
 * Phase 9 Quality Control panel.
 *
 * Shows the pipeline step: Recording → Checking Actions → Passed → Ready to Render.
 * Lists per-scene action verification results. Surfaces human-review cards
 * (Retry / Skip / Abort) for actions that need a decision before rendering.
 */
export function QualityCheckPanel({
  jobId,
  hasRecording,
  initialReport,
}: {
  jobId: string;
  hasRecording: boolean;
  initialReport?: QualityReport;
}) {
  const [report, setReport] = useState<QualityReport | undefined>(initialReport);
  const [loading, setLoading] = useState(false);
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function runCheck() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/quality-check`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error ?? { code: "error", message: "Quality check failed." });
        return;
      }
      setReport(json.qualityReport as QualityReport);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setLoading(false);
    }
  }

  async function decide(
    sceneId: string,
    actionId: string,
    decision: "RETRY" | "SKIP" | "ABORT"
  ) {
    const key = `${sceneId}::${actionId}`;
    setReviewing(key);
    try {
      const res = await fetch(`/api/demo/${jobId}/quality-check`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, actionId, decision }),
      });
      const json = await res.json();
      if (json.qualityReport) setReport(json.qualityReport as QualityReport);
    } finally {
      setReviewing(null);
    }
  }

  const humanReviewCount = report?.humanReviewActions ?? 0;
  const blocksRendering = report?.blocksRendering ?? false;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <ShieldCheck className="h-4 w-4" />
            Quality Check
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Verify that every important browser action produced the expected
            page state.
          </p>
        </div>
        <Button
          size="sm"
          onClick={runCheck}
          disabled={!hasRecording || loading}
          variant={report ? "outline" : "primary"}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          {report ? "Re-run check" : "Run quality check"}
        </Button>
      </div>

      {!hasRecording && !report && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Generate a browser recording first, then run the quality check.
        </div>
      )}

      {loading && (
        <PipelineStep current="checking" />
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {report && !loading && (
        <>
          <PipelineStep current={blocksRendering ? "review" : "passed"} />

          {/* Metrics bar */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Total" value={String(report.totalActions)} />
            <Metric label="Passed" value={String(report.passedActions)} color="green" />
            <Metric label="Failed" value={String(report.failedActions)} color="red" />
            <Metric label="Review" value={String(report.humanReviewActions)} color="amber" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Verification rate {(report.verificationRate * 100).toFixed(0)}%
            {report.visionModelCallCount > 0
              ? ` · ${report.visionModelCallCount} vision model call${report.visionModelCallCount === 1 ? "" : "s"}`
              : " · rule-based only"}
          </p>

          {blocksRendering && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                <strong>{humanReviewCount} action{humanReviewCount === 1 ? "" : "s"}</strong> require{humanReviewCount === 1 ? "s" : ""} your
                decision before the final video can be rendered.
              </p>
            </div>
          )}

          {/* Per-scene results */}
          <div className="mt-5 space-y-4">
            {report.sceneReports.map((sr) => (
              <details key={sr.sceneId} className="rounded-lg border border-border" open={sr.humanReviewActions > 0}>
                <summary className="flex cursor-pointer items-center justify-between gap-2 rounded-t-lg px-4 py-3 text-sm font-medium select-none">
                  <span>{sr.title}</span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                    {sr.passedActions}
                    {sr.failedActions > 0 && (
                      <>
                        <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                        {sr.failedActions}
                      </>
                    )}
                    {sr.humanReviewActions > 0 && (
                      <>
                        <Eye className="h-3.5 w-3.5 text-amber-600" />
                        {sr.humanReviewActions}
                      </>
                    )}
                  </span>
                </summary>
                <ol className="divide-y divide-border border-t border-border">
                  {sr.actions.map((action) => (
                    <ActionItem
                      key={action.actionId}
                      item={action}
                      sceneId={sr.sceneId}
                      reviewing={reviewing}
                      onDecide={decide}
                    />
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PipelineStep({ current }: { current: "checking" | "review" | "passed" }) {
  const steps = [
    { id: "recording", label: "Recording", done: true },
    { id: "checking", label: "Checking Actions" },
    { id: "passed", label: "Passed" },
    { id: "render_ready", label: "Ready to Render" },
  ];
  const activeIndex = steps.findIndex((s) =>
    current === "review" ? s.id === "checking" : s.id === current
  );
  return (
    <div className="mt-5 flex items-center gap-0">
      {steps.map((step, i) => {
        const isActive = i === activeIndex;
        const isDone = i < activeIndex || (current === "passed" && i <= 2);
        return (
          <div key={step.id} className="flex flex-1 items-center">
            <div className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              isDone ? "bg-primary text-primary-foreground" :
              isActive ? "border-2 border-primary text-primary" :
              "border-2 border-border text-muted-foreground"
            )}>
              {isDone ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
            </div>
            <span className={cn(
              "ml-1.5 text-xs",
              isDone ? "font-medium text-foreground" :
              isActive ? "font-semibold text-primary" :
              "text-muted-foreground"
            )}>
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <div className={cn(
                "mx-2 flex-1 border-t",
                i < activeIndex ? "border-primary" : "border-border"
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: "green" | "red" | "amber" }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn(
        "text-lg font-semibold",
        color === "green" && Number(value) > 0 ? "text-green-700" :
        color === "red" && Number(value) > 0 ? "text-red-700" :
        color === "amber" && Number(value) > 0 ? "text-amber-700" : ""
      )}>
        {value}
      </p>
    </div>
  );
}

function ActionItem({
  item,
  sceneId,
  reviewing,
  onDecide,
}: {
  item: ActionQualityItem;
  sceneId: string;
  reviewing: string | null;
  onDecide: (sceneId: string, actionId: string, decision: "RETRY" | "SKIP" | "ABORT") => void;
}) {
  const key = `${sceneId}::${item.actionId}`;
  const isBusy = reviewing === key;
  const review = item.humanReview;

  const outcomeIcon = {
    PASS: <CheckCircle2 className="h-4 w-4 text-green-600" />,
    RETRIED_PASS: <CheckCircle2 className="h-4 w-4 text-green-500" />,
    FAIL: <AlertCircle className="h-4 w-4 text-red-600" />,
    HUMAN_REVIEW: <Eye className="h-4 w-4 text-amber-600" />,
    SKIPPED_BY_USER: <SkipForward className="h-4 w-4 text-muted-foreground" />,
    NO_CHECK: <span className="h-4 w-4 rounded-full border border-border" />,
  }[item.outcome] ?? null;

  return (
    <li className={cn("px-4 py-3", item.outcome === "HUMAN_REVIEW" && "bg-amber-50/50")}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{outcomeIcon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{item.summary}</p>
          {item.failReason && (
            <p className="mt-0.5 text-xs text-muted-foreground">{item.failReason}</p>
          )}
          {item.retryCount > 0 && (
            <p className="text-xs text-muted-foreground">
              {item.retryCount} retry{item.retryCount > 1 ? "ies" : ""}
              {item.visionModelUsed ? " · vision model used" : ""}
            </p>
          )}
          {item.screenshotPath && (
            <a
              href={item.screenshotPath}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground underline"
            >
              <Camera className="h-3 w-3" /> screenshot
            </a>
          )}

          {/* Human review card */}
          {item.outcome === "HUMAN_REVIEW" && review && !review.decision && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-semibold text-amber-800">
                Human Review Required
              </p>
              <p className="mt-1 text-xs text-amber-700">
                Expected: {review.expectedState.description}
              </p>
              {review.failReason && (
                <p className="text-xs text-amber-700">Actual: {review.failReason}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={isBusy}
                  onClick={() => onDecide(sceneId, item.actionId, "RETRY")}
                >
                  {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  Retry
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={isBusy}
                  onClick={() => onDecide(sceneId, item.actionId, "SKIP")}
                >
                  <SkipForward className="h-3.5 w-3.5" /> Skip
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isBusy}
                  onClick={() => onDecide(sceneId, item.actionId, "ABORT")}
                  className="text-red-600 hover:bg-red-50"
                >
                  <XCircle className="h-3.5 w-3.5" /> Abort
                </Button>
              </div>
            </div>
          )}
          {review?.decision && (
            <p className="mt-1 text-xs text-muted-foreground">
              Decision: <strong>{review.decision}</strong>
            </p>
          )}
        </div>
      </div>
    </li>
  );
}
