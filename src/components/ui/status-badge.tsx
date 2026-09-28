import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/options";
import type { DemoStatus } from "@/types";

const STATUS_STYLES: Record<DemoStatus, string> = {
  ready_for_exploration: "bg-accent text-accent-foreground",
  in_progress: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  failed: "bg-red-100 text-red-700",
  DRAFT: "bg-secondary text-secondary-foreground",
  EXPLORING: "bg-blue-100 text-blue-700",
  PLANNING: "bg-blue-100 text-blue-700",
  STORYBOARD_READY: "bg-accent text-accent-foreground",
  ACTIONS_READY: "bg-accent text-accent-foreground",
  RECORDING: "bg-blue-100 text-blue-700",
  RECORDING_COMPLETE: "bg-green-100 text-green-700",
  RECORDING_FAILED: "bg-red-100 text-red-700",
  VOICE_GENERATING: "bg-blue-100 text-blue-700",
  VOICE_READY: "bg-green-100 text-green-700",
  VOICE_FAILED: "bg-red-100 text-red-700",
  RENDERING: "bg-blue-100 text-blue-700",
  RENDER_COMPLETE: "bg-green-100 text-green-700",
  RENDER_FAILED: "bg-red-100 text-red-700",
};

export function StatusBadge({
  status,
  className,
}: {
  status: DemoStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
        className
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
