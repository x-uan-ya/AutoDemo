import { Check, Circle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { PIPELINE_STAGE_LABELS } from "@/lib/options";
import type { PipelineStageState } from "@/types";

/**
 * Vertical pipeline showing each generation stage and its status. UI-only for
 * this milestone: every stage is "pending" until the processing layers exist.
 */
export function ProgressPipeline({
  pipeline,
}: {
  pipeline: PipelineStageState[];
}) {
  return (
    <ol className="relative flex flex-col">
      {pipeline.map((step, index) => {
        const isLast = index === pipeline.length - 1;
        return (
          <li key={step.stage} className="flex gap-4">
            <div className="flex flex-col items-center">
              <StageIcon status={step.status} />
              {!isLast && (
                <span
                  className={cn(
                    "w-px flex-1",
                    step.status === "completed"
                      ? "bg-primary"
                      : "bg-border"
                  )}
                />
              )}
            </div>
            <div className={cn("pb-8", isLast && "pb-0")}>
              <p
                className={cn(
                  "text-sm font-medium",
                  step.status === "pending"
                    ? "text-muted-foreground"
                    : "text-foreground"
                )}
              >
                {PIPELINE_STAGE_LABELS[step.stage]}
              </p>
              <p className="text-xs capitalize text-muted-foreground">
                {step.status}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StageIcon({ status }: { status: PipelineStageState["status"] }) {
  const base =
    "flex h-7 w-7 items-center justify-center rounded-full border";
  switch (status) {
    case "completed":
      return (
        <span className={cn(base, "border-primary bg-primary text-primary-foreground")}>
          <Check className="h-4 w-4" />
        </span>
      );
    case "active":
      return (
        <span className={cn(base, "border-primary text-primary")}>
          <Loader2 className="h-4 w-4 animate-spin" />
        </span>
      );
    case "failed":
      return (
        <span className={cn(base, "border-red-400 text-red-500")}>
          <Circle className="h-4 w-4" />
        </span>
      );
    default:
      return (
        <span className={cn(base, "border-border text-muted-foreground")}>
          <Circle className="h-3 w-3" />
        </span>
      );
  }
}
