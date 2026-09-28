"use client";

import { useState } from "react";
import {
  Sparkles,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  AlertCircle,
  Quote,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DiscoveredFeature, FeatureDiscoveryMeta } from "@/types";

interface ApiError {
  code: string;
  message: string;
}

type Phase = "idle" | "discovering" | "done" | "error";

/**
 * Client panel for the Feature Discovery stage on the demo detail page.
 *
 * Runs discovery via POST /api/demo/[id]/discover, shows loading/error states,
 * renders each feature with its evidence + scores, and lets the user
 * select/deselect features (persisted via PATCH /api/demo/[id]/features).
 */
export function FeatureDiscoveryPanel({
  jobId,
  initialFeatures,
  initialMeta,
}: {
  jobId: string;
  initialFeatures: DiscoveredFeature[];
  initialMeta?: FeatureDiscoveryMeta;
}) {
  const [features, setFeatures] = useState<DiscoveredFeature[]>(initialFeatures);
  const [meta, setMeta] = useState<FeatureDiscoveryMeta | undefined>(initialMeta);
  const [phase, setPhase] = useState<Phase>(
    initialFeatures.length > 0 ? "done" : "idle"
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const busy = phase === "discovering";
  const hasRun = phase === "done" && features.length > 0;

  async function runDiscovery() {
    setPhase("discovering");
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/discover`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(
          json?.error ?? {
            code: "error",
            message: "Feature discovery failed. Please try again.",
          }
        );
        setPhase("error");
        return;
      }
      setFeatures(json.data.features as DiscoveredFeature[]);
      setMeta(json.data.meta as FeatureDiscoveryMeta);
      setPhase("done");
    } catch {
      setError({
        code: "network_error",
        message: "Could not reach the server. Check your connection and retry.",
      });
      setPhase("error");
    }
  }

  async function toggle(feature: DiscoveredFeature) {
    const next = !feature.selected;
    // Optimistic update.
    setFeatures((prev) =>
      prev.map((f) => (f.id === feature.id ? { ...f, selected: next } : f))
    );
    setPendingId(feature.id);
    try {
      const res = await fetch(`/api/demo/${jobId}/features`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featureId: feature.id, selected: next }),
      });
      if (!res.ok) throw new Error("failed");
    } catch {
      // Revert on failure.
      setFeatures((prev) =>
        prev.map((f) =>
          f.id === feature.id ? { ...f, selected: !next } : f
        )
      );
    } finally {
      setPendingId(null);
    }
  }

  const selectedCount = features.filter((f) => f.selected).length;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            Discovered Features
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasRun
              ? `${selectedCount} of ${features.length} selected for the demo.`
              : "Analyze the website to find demonstrable features."}
          </p>
        </div>
        <Button onClick={runDiscovery} disabled={busy} size="sm">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {hasRun ? "Re-run discovery" : "Discover features"}
        </Button>
      </div>

      {busy && <DiscoveringState />}

      {phase === "error" && error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {hasRun && (
        <>
          <ul className="mt-5 space-y-3">
            {features.map((feature) => (
              <FeatureItem
                key={feature.id}
                feature={feature}
                pending={pendingId === feature.id}
                onToggle={() => toggle(feature)}
              />
            ))}
          </ul>
          {meta && <MetaFooter meta={meta} />}
        </>
      )}

      {phase === "idle" && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No features discovered yet.
        </div>
      )}
    </div>
  );
}

function DiscoveringState() {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-accent/40 px-4 py-4 text-sm">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <div>
        <p className="font-medium">Analyzing the website...</p>
        <p className="text-muted-foreground">
          Exploring the page and identifying features from its content and
          screenshots. This can take up to a minute.
        </p>
      </div>
    </div>
  );
}

function FeatureItem({
  feature,
  pending,
  onToggle,
}: {
  feature: DiscoveredFeature;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      className={cn(
        "rounded-lg border p-4 transition-colors",
        feature.selected ? "border-primary bg-accent/30" : "border-border"
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={feature.selected}
          onChange={onToggle}
          disabled={pending}
          aria-label={`Select ${feature.name}`}
          className="mt-1 h-4 w-4 shrink-0 rounded border-input accent-[hsl(var(--primary))]"
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-medium">{feature.name}</h3>
            {feature.safeToDemo ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                <ShieldCheck className="h-3 w-3" /> Safe to demo
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                <ShieldAlert className="h-3 w-3" /> Needs caution
              </span>
            )}
          </div>

          <p className="mt-1 text-sm text-muted-foreground">
            {feature.description}
          </p>

          <div className="mt-3 flex flex-wrap gap-4 text-xs">
            <ScoreBar label="Importance" value={feature.importance} />
            <ScoreBar label="Confidence" value={feature.confidence} />
          </div>

          {feature.evidence.length > 0 && (
            <div className="mt-3">
              <p className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Quote className="h-3 w-3" /> Evidence
              </p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {feature.evidence.map((e, i) => (
                  <li
                    key={i}
                    className="rounded-md bg-secondary px-2 py-0.5 text-xs text-foreground"
                  >
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="min-w-[130px] flex-1">
      <div className="flex items-center justify-between text-muted-foreground">
        <span>{label}</span>
        <span className="font-medium text-foreground">{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function MetaFooter({ meta }: { meta: FeatureDiscoveryMeta }) {
  const parts: string[] = [
    `${meta.provider} · ${meta.model}`,
    `${(meta.durationMs / 1000).toFixed(1)}s`,
  ];
  if (meta.totalTokens != null) parts.push(`${meta.totalTokens} tokens`);
  if (meta.estimatedCostUsd != null)
    parts.push(`~$${meta.estimatedCostUsd.toFixed(4)}`);

  return (
    <p className="mt-5 border-t border-border pt-3 text-xs text-muted-foreground">
      {parts.join("  ·  ")}
    </p>
  );
}
