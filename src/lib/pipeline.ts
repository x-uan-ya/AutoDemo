import type { PipelineStageState, StageStatus } from "@/types";
import { PIPELINE_ORDER } from "@/lib/options";

/**
 * Build a fresh pipeline for a newly created job. Every stage starts as
 * "pending" because in this milestone no processing has run yet.
 */
export function createInitialPipeline(): PipelineStageState[] {
  return PIPELINE_ORDER.map((stage) => ({
    stage,
    status: "pending" as StageStatus,
  }));
}
