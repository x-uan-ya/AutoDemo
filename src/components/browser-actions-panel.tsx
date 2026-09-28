"use client";

import { useState } from "react";
import {
  MousePointerClick,
  Loader2,
  ChevronUp,
  ChevronDown,
  Trash2,
  CheckCircle2,
  Lock,
  AlertCircle,
  ShieldAlert,
  Pencil,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ActionPlan,
  BrowserAction,
  PlannedBrowserAction,
  SceneActionSet,
} from "@/lib/browser/types";

interface ApiError {
  code: string;
  message: string;
}

/**
 * Phase 4 action preview UI.
 *
 * Shows the generated browser actions grouped by scene. Each action shows its
 * type, human-readable description, selector (when applicable), and status
 * (flagged actions are marked "needs approval"). The user can regenerate the
 * whole plan, edit an action's description, delete an action, and reorder
 * actions within a scene, then approve the plan.
 *
 * All edits go back through the API (which re-validates against the allowlist),
 * so the client can never introduce an unsafe action.
 */
export function BrowserActionsPanel({
  jobId,
  initialActionPlan,
  storyboardApproved,
}: {
  jobId: string;
  initialActionPlan?: ActionPlan;
  storyboardApproved: boolean;
}) {
  const [plan, setPlan] = useState<ActionPlan | undefined>(initialActionPlan);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);
  const [savingScene, setSavingScene] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const approved = plan?.status === "approved";

  async function generate() {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demoId: jobId }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error ?? { code: "error", message: "Failed to generate actions." });
        return;
      }
      setPlan(json.actionPlan as ActionPlan);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setGenerating(false);
    }
  }

  // Persist a scene's raw actions (edit/delete/reorder all go through here).
  async function persistScene(sceneId: string, actions: BrowserAction[]) {
    setSavingScene(sceneId);
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/actions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, actions }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error ?? { code: "error", message: "Failed to save actions." });
        return;
      }
      setPlan(json.actionPlan as ActionPlan);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setSavingScene(null);
    }
  }

  async function approve() {
    setApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/actions/approve`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error ?? { code: "error", message: "Approval failed." });
        return;
      }
      setPlan(json.actionPlan as ActionPlan);
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setApproving(false);
    }
  }

  const scenes = plan?.scenes ?? [];

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <MousePointerClick className="h-4 w-4" />
            Browser Actions
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {plan
              ? `${scenes.length} scene(s) · structured, allowlisted actions.`
              : "Convert the approved storyboard into safe browser actions."}
          </p>
        </div>
        <Button
          onClick={generate}
          disabled={!storyboardApproved || generating || approving}
          size="sm"
          variant={plan ? "outline" : "primary"}
        >
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          {plan ? "Regenerate actions" : "Generate actions"}
        </Button>
      </div>

      {!storyboardApproved && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Approve the storyboard first, then generate browser actions.
        </div>
      )}

      {generating && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-accent/40 px-4 py-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <p className="font-medium">Generating browser actions...</p>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {plan && scenes.length > 0 && (
        <>
          {plan.hasFlaggedActions && (
            <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Some actions look sensitive (e.g. checkout, delete, logout) and
                are marked <strong>needs approval</strong>. They will not run
                automatically.
              </span>
            </div>
          )}

          <div className="mt-5 space-y-5">
            {scenes.map((scene) => (
              <SceneActions
                key={scene.sceneId}
                scene={scene}
                locked={approved}
                saving={savingScene === scene.sceneId}
                onPersist={(actions) => persistScene(scene.sceneId, actions)}
              />
            ))}
          </div>

          <ApprovalBar
            approved={approved}
            approving={approving}
            onApprove={approve}
          />
        </>
      )}
    </div>
  );
}

function SceneActions({
  scene,
  locked,
  saving,
  onPersist,
}: {
  scene: SceneActionSet;
  locked: boolean;
  saving: boolean;
  onPersist: (actions: BrowserAction[]) => void;
}) {
  const actions = scene.actions;

  function rawActions(): BrowserAction[] {
    return actions.map((a) => a.action);
  }

  function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= actions.length) return;
    const raw = rawActions();
    [raw[index], raw[target]] = [raw[target], raw[index]];
    onPersist(raw);
  }

  function remove(index: number) {
    const raw = rawActions().filter((_, i) => i !== index);
    onPersist(raw);
  }

  function editDescription(index: number, description: string) {
    const raw = rawActions();
    const a = raw[index];
    // Only the action types that carry a description can be edited here.
    if (
      a.type === "click" ||
      a.type === "fill" ||
      a.type === "select" ||
      a.type === "hover"
    ) {
      raw[index] = { ...a, description };
      onPersist(raw);
    }
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center justify-between border-b border-border bg-secondary/40 px-4 py-2">
        <h3 className="text-sm font-medium">
          Scene {scene.order}: {scene.title}
        </h3>
        <span className="text-xs text-muted-foreground">
          {actions.length} action{actions.length === 1 ? "" : "s"}
        </span>
      </div>

      <ol className="divide-y divide-border">
        {actions.map((planned, i) => (
          <ActionRow
            key={planned.id}
            planned={planned}
            index={i}
            total={actions.length}
            locked={locked}
            busy={saving}
            onMoveUp={() => move(i, -1)}
            onMoveDown={() => move(i, 1)}
            onRemove={() => remove(i)}
            onEditDescription={(d) => editDescription(i, d)}
          />
        ))}
        {actions.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted-foreground">
            No actions for this scene.
          </li>
        )}
      </ol>
    </div>
  );
}

function ActionRow({
  planned,
  index,
  total,
  locked,
  busy,
  onMoveUp,
  onMoveDown,
  onRemove,
  onEditDescription,
}: {
  planned: PlannedBrowserAction;
  index: number;
  total: number;
  locked: boolean;
  busy: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onEditDescription: (description: string) => void;
}) {
  const { action } = planned;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(
    "description" in action ? action.description : ""
  );

  const hasSelector = "selector" in action;
  const canEdit =
    action.type === "click" ||
    action.type === "fill" ||
    action.type === "select" ||
    action.type === "hover";

  return (
    <li className="px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 rounded bg-secondary px-1.5 py-0.5 font-mono text-xs uppercase text-foreground">
          {action.type}
        </span>

        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                size="sm"
                onClick={() => {
                  onEditDescription(draft);
                  setEditing(false);
                }}
                disabled={busy}
              >
                Save
              </Button>
              <Button size="icon" variant="ghost" onClick={() => setEditing(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <p className="text-sm">{planned.summary}</p>
          )}

          {hasSelector && (
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {(action as { selector: string }).selector}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            {planned.requiresHumanApproval ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700">
                <ShieldAlert className="h-3 w-3" /> needs approval
                {planned.approvalReason ? ` · ${planned.approvalReason}` : ""}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">
                <CheckCircle2 className="h-3 w-3" /> ready
              </span>
            )}
          </div>
        </div>

        {!locked && (
          <div className="flex shrink-0 items-center gap-0.5">
            {canEdit && !editing && (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Edit description"
                onClick={() => {
                  setDraft("description" in action ? action.description : "");
                  setEditing(true);
                }}
                disabled={busy}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              size="icon"
              variant="ghost"
              aria-label="Move up"
              onClick={onMoveUp}
              disabled={index === 0 || busy}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Move down"
              onClick={onMoveDown}
              disabled={index === total - 1 || busy}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Delete action"
              onClick={onRemove}
              disabled={busy}
              className="text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function ApprovalBar({
  approved,
  approving,
  onApprove,
}: {
  approved: boolean;
  approving: boolean;
  onApprove: () => void;
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
      {approved ? (
        <p className="flex items-center gap-2 text-sm font-medium text-green-700">
          <Lock className="h-4 w-4" />
          Browser actions approved.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Review the actions, then approve. Recording is a later phase and is
          not started here.
        </p>
      )}
      <Button onClick={onApprove} disabled={approved || approving}>
        {approving && <Loader2 className="h-4 w-4 animate-spin" />}
        {approved ? (
          <>
            <CheckCircle2 className="h-4 w-4" /> Approved
          </>
        ) : (
          "Approve Browser Actions"
        )}
      </Button>
    </div>
  );
}
