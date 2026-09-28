"use client";

import { useMemo, useState } from "react";
import {
  Clapperboard,
  Loader2,
  ChevronUp,
  ChevronDown,
  Trash2,
  RefreshCw,
  CheckCircle2,
  Lock,
  AlertCircle,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatSeconds } from "@/lib/utils";
import { computePlanMetrics } from "@/lib/planner/duration-planner";
import { PURPOSE_OPTIONS, labelFor } from "@/lib/options";
import type { DemoPlan, PlanScene } from "@/types";

interface ApiError {
  code: string;
  message: string;
}

type Busy =
  | { kind: "generate" }
  | { kind: "approve" }
  | { kind: "scene"; id: string; action: "save" | "regen" | "remove" | "move" }
  | null;

/**
 * Editable storyboard for the Demo Planner stage.
 *
 * Lets the user generate a plan, edit narration/title, reorder, remove, and
 * regenerate individual scenes, then approve the storyboard. Recording is
 * gated on approval elsewhere; here we surface the approval state clearly.
 */
export function StoryboardPanel({
  jobId,
  initialPlan,
  hasFeatures,
}: {
  jobId: string;
  initialPlan?: DemoPlan;
  hasFeatures: boolean;
}) {
  const [plan, setPlan] = useState<DemoPlan | undefined>(initialPlan);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const scenes = plan?.scenes ?? [];
  const approved = plan?.status === "approved";

  const metrics = useMemo(
    () => computePlanMetrics(scenes, plan?.targetSeconds ?? 0),
    [scenes, plan?.targetSeconds]
  );

  function applyPlan(next: DemoPlan | undefined) {
    setPlan(next);
  }

  async function generate() {
    setBusy({ kind: "generate" });
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/plan`, { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error ?? { code: "error", message: "Planning failed." });
        return;
      }
      applyPlan(json.data.plan as DemoPlan);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  // Persist the full scene list (used for edit/reorder/remove).
  async function persistScenes(nextScenes: PlanScene[]) {
    const res = await fetch(`/api/demo/${jobId}/plan`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scenes: nextScenes.map((s) => ({
          id: s.id,
          featureId: s.featureId,
          title: s.title,
          objective: s.objective,
          narration: s.narration,
          estimatedDuration: s.estimatedDuration,
          evidence: s.evidence,
        })),
      }),
    });
    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message ?? "Failed to save.");
    }
    applyPlan(json.data.plan as DemoPlan);
  }

  async function saveScene(updated: PlanScene) {
    setBusy({ kind: "scene", id: updated.id, action: "save" });
    setError(null);
    try {
      await persistScenes(
        scenes.map((s) => (s.id === updated.id ? updated : s))
      );
    } catch (e) {
      setError({ code: "save", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const idx = scenes.findIndex((s) => s.id === id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= scenes.length) return;
    const next = [...scenes];
    [next[idx], next[target]] = [next[target], next[idx]];
    setBusy({ kind: "scene", id, action: "move" });
    setError(null);
    try {
      await persistScenes(next);
    } catch (e) {
      setError({ code: "reorder", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy({ kind: "scene", id, action: "remove" });
    setError(null);
    try {
      await persistScenes(scenes.filter((s) => s.id !== id));
    } catch (e) {
      setError({ code: "remove", message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function regenerate(id: string) {
    setBusy({ kind: "scene", id, action: "regen" });
    setError(null);
    try {
      const res = await fetch(
        `/api/demo/${jobId}/plan/scene/${id}/regenerate`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }
      );
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error ?? { code: "error", message: "Regeneration failed." });
        return;
      }
      applyPlan(json.data.plan as DemoPlan);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  async function approve() {
    setBusy({ kind: "approve" });
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/plan/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error ?? { code: "error", message: "Approval failed." });
        return;
      }
      applyPlan(json.data.plan as DemoPlan);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setBusy(null);
    }
  }

  const generating = busy?.kind === "generate";

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Clapperboard className="h-4 w-4" />
            Storyboard
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan
              ? `${labelFor(PURPOSE_OPTIONS, plan.purpose)} · target ${formatSeconds(
                  plan.targetSeconds
                )}`
              : "Generate a scene-by-scene plan from your selected features."}
          </p>
        </div>
        <Button
          onClick={generate}
          disabled={!hasFeatures || generating || busy?.kind === "approve"}
          size="sm"
          variant={plan ? "outline" : "primary"}
        >
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          {plan ? "Regenerate plan" : "Generate storyboard"}
        </Button>
      </div>

      {!hasFeatures && !plan && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Discover and select features first, then generate a storyboard.
        </div>
      )}

      {generating && <GeneratingState />}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {plan && scenes.length > 0 && (
        <>
          <MetricsBar
            sceneCount={metrics.sceneCount}
            plannedSeconds={metrics.plannedSeconds}
            speakingSeconds={metrics.estimatedSpeakingSeconds}
            targetSeconds={metrics.targetSeconds}
          />

          <ol className="mt-5 space-y-4">
            {scenes.map((scene, i) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                index={i}
                total={scenes.length}
                locked={approved}
                busy={busy}
                onSave={saveScene}
                onMove={move}
                onRemove={remove}
                onRegenerate={regenerate}
              />
            ))}
          </ol>

          <ApprovalBar
            approved={approved}
            approving={busy?.kind === "approve"}
            approvedAt={plan.approvedAt}
            onApprove={approve}
          />
        </>
      )}
    </div>
  );
}

function GeneratingState() {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-accent/40 px-4 py-4 text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <div>
        <p className="font-medium">Planning the demo...</p>
        <p className="text-muted-foreground">
          Selecting high-value features for the target duration and writing
          evidence-grounded narration.
        </p>
      </div>
    </div>
  );
}

function MetricsBar({
  sceneCount,
  plannedSeconds,
  speakingSeconds,
  targetSeconds,
}: {
  sceneCount: number;
  plannedSeconds: number;
  speakingSeconds: number;
  targetSeconds: number;
}) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Metric label="Scenes" value={String(sceneCount)} />
      <Metric label="Planned" value={formatSeconds(plannedSeconds)} />
      <Metric label="Speaking est." value={formatSeconds(speakingSeconds)} />
      <Metric label="Target" value={formatSeconds(targetSeconds)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
    </div>
  );
}

function SceneCard({
  scene,
  index,
  total,
  locked,
  busy,
  onSave,
  onMove,
  onRemove,
  onRegenerate,
}: {
  scene: PlanScene;
  index: number;
  total: number;
  locked: boolean;
  busy: Busy;
  onSave: (s: PlanScene) => void;
  onMove: (id: string, dir: -1 | 1) => void;
  onRemove: (id: string) => void;
  onRegenerate: (id: string) => void;
}) {
  const [title, setTitle] = useState(scene.title);
  const [narration, setNarration] = useState(scene.narration);

  const dirty = title !== scene.title || narration !== scene.narration;
  const sceneBusy = busy?.kind === "scene" && busy.id === scene.id;
  const action = busy?.kind === "scene" ? busy.action : undefined;

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
          {scene.order}
        </span>

        <div className="min-w-0 flex-1">
          {/* Title */}
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={locked || sceneBusy}
            className="w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-base font-medium hover:border-input focus:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
          />

          {scene.objective && (
            <p className="mt-1 px-1 text-xs text-muted-foreground">
              Objective: {scene.objective}
            </p>
          )}

          {/* Narration */}
          <textarea
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            disabled={locked || sceneBusy}
            rows={3}
            className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
          />

          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>~{scene.estimatedDuration}s</span>
            {scene.evidence.length > 0 && (
              <span className="flex items-center gap-1">
                <Quote className="h-3 w-3" />
                {scene.evidence.length} evidence
              </span>
            )}
          </div>

          {scene.evidence.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {scene.evidence.slice(0, 6).map((e, i) => (
                <li
                  key={i}
                  className="rounded-md bg-secondary px-2 py-0.5 text-xs text-foreground"
                >
                  {e}
                </li>
              ))}
            </ul>
          )}

          {/* Actions */}
          {!locked && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                onClick={() => onSave({ ...scene, title, narration })}
                disabled={!dirty || sceneBusy}
              >
                {sceneBusy && action === "save" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                )}
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onRegenerate(scene.id)}
                disabled={sceneBusy}
              >
                {sceneBusy && action === "regen" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Regenerate
              </Button>
              <div className="ml-auto flex items-center gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move up"
                  onClick={() => onMove(scene.id, -1)}
                  disabled={index === 0 || sceneBusy}
                >
                  <ChevronUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Move down"
                  onClick={() => onMove(scene.id, 1)}
                  disabled={index === total - 1 || sceneBusy}
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove scene"
                  onClick={() => onRemove(scene.id)}
                  disabled={sceneBusy || total <= 1}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function ApprovalBar({
  approved,
  approving,
  approvedAt,
  onApprove,
}: {
  approved: boolean;
  approving: boolean;
  approvedAt?: string;
  onApprove: () => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
      {approved ? (
        <p className="flex items-center gap-2 text-sm font-medium text-green-700">
          <Lock className="h-4 w-4" />
          Storyboard approved. Recording can begin.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Review the scenes, then approve. Recording will not start until the
          storyboard is approved.
        </p>
      )}
      <Button onClick={onApprove} disabled={approved || approving}>
        {approving && <Loader2 className="h-4 w-4 animate-spin" />}
        {approved ? (
          <>
            <CheckCircle2 className="h-4 w-4" /> Approved
          </>
        ) : (
          "Approve Storyboard"
        )}
      </Button>
    </div>
  );
}
