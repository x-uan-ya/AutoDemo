"use client";

import { useRef, useState } from "react";
import {
  Film,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
  Mic,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatSeconds } from "@/lib/utils";
import { LANGUAGE_OPTIONS, VOICE_OPTIONS, PURPOSE_OPTIONS, labelFor } from "@/lib/options";
import type { DemoLanguage, DemoVoice, DemoPurpose, RenderResult } from "@/types";

interface ApiError {
  code: string;
  message: string;
}

type Phase = "idle" | "rendering" | "done" | "failed";

/**
 * Phase 7 final render + preview UI.
 *
 * "Generate Video" (enabled once a recording and voice exist) renders the MP4
 * via the render API, shows progress, then previews the video with its
 * metadata and Download / Regenerate Voice / Regenerate Video actions.
 */
export function RenderPanel({
  jobId,
  canRender,
  language,
  voice,
  purpose,
  initialRender,
}: {
  jobId: string;
  canRender: boolean;
  language: DemoLanguage;
  voice: DemoVoice;
  purpose: DemoPurpose;
  initialRender?: RenderResult;
}) {
  const [render, setRender] = useState<RenderResult | undefined>(initialRender);
  const [phase, setPhase] = useState<Phase>(
    initialRender
      ? initialRender.status === "render_complete"
        ? "done"
        : "failed"
      : "idle"
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [progress, setProgress] = useState("");
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function startProgress() {
    const steps = [
      "Preparing project...",
      "Bundling video...",
      "Rendering frames...",
      "Encoding MP4...",
      "Finalizing...",
    ];
    let i = 0;
    setProgress(steps[0]);
    progressTimer.current = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setProgress(steps[i]);
    }, 2500);
  }
  function stopProgress() {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }

  async function renderVideo() {
    setPhase("rendering");
    setError(null);
    startProgress();
    try {
      const res = await fetch(`/api/demo/${jobId}/render`, { method: "POST" });
      const json = await res.json();
      stopProgress();
      if (res.status === 409) {
        setError(json?.error ?? { code: "conflict", message: "Not ready to render." });
        setPhase(render ? "done" : "idle");
        return;
      }
      const result: RenderResult = {
        status: json.success ? "render_complete" : "render_failed",
        videoPath: json.videoPath ?? null,
        duration: json.duration ?? 0,
        config: json.config ?? { width: 1920, height: 1080, fps: 30 },
        sceneCount: json.sceneCount ?? 0,
        error: json?.error?.message,
        renderedAt: new Date().toISOString(),
      };
      setRender(result);
      setPhase(result.status === "render_complete" ? "done" : "failed");
      if (result.status === "render_failed") {
        setError(json?.error ?? { code: "failed", message: "Rendering failed." });
      }
    } catch {
      stopProgress();
      setError({ code: "network", message: "Could not reach the server." });
      setPhase(render ? "done" : "idle");
    }
  }

  const rendering = phase === "rendering";

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Film className="h-4 w-4" />
            Final Video
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Combine the recording, narration, and captions into a polished MP4.
          </p>
        </div>
        <Button
          onClick={renderVideo}
          disabled={!canRender || rendering}
          size="sm"
          variant={render?.status === "render_complete" ? "outline" : "primary"}
        >
          {rendering && <Loader2 className="h-4 w-4 animate-spin" />}
          {render?.status === "render_complete" ? "Regenerate Video" : "Generate Video"}
        </Button>
      </div>

      {!canRender && !render && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          A completed browser recording and scene narration are required before
          rendering the final video.
        </div>
      )}

      {rendering && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-accent/40 px-4 py-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <div>
            <p className="font-medium">{progress || "Rendering..."}</p>
            <p className="text-muted-foreground">
              Rendering can take a few minutes depending on the number of scenes.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {phase === "done" && render?.videoPath && (
        <div className="mt-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Demo video ready
          </p>

          <video
            src={render.videoPath}
            controls
            className="w-full rounded-lg border border-border bg-black"
          />

          <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Meta label="Duration" value={formatSeconds(Math.round(render.duration))} />
            <Meta label="Language" value={labelFor(LANGUAGE_OPTIONS, language)} />
            <Meta label="Voice" value={labelFor(VOICE_OPTIONS, voice)} />
            <Meta label="Purpose" value={labelFor(PURPOSE_OPTIONS, purpose)} />
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {render.config.width}×{render.config.height} · {render.config.fps}fps ·{" "}
            {render.sceneCount} scene{render.sceneCount === 1 ? "" : "s"}
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <a
              href={render.videoPath}
              download
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
            >
              <Download className="h-4 w-4" /> Download
            </a>
            <a
              href="#voice"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-border px-4 text-sm font-medium hover:bg-secondary/60"
            >
              <Mic className="h-4 w-4" /> Regenerate Voice
            </a>
            <Button variant="outline" onClick={renderVideo} disabled={rendering}>
              <RefreshCw className="h-4 w-4" /> Regenerate Video
            </Button>
          </div>
        </div>
      )}

      {phase === "failed" && (
        <div className="mt-5">
          <p className="flex items-center gap-2 text-sm font-medium text-red-700">
            <AlertCircle className="h-4 w-4" />
            Rendering failed
          </p>
          {render?.error && (
            <p className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              {render.error}
            </p>
          )}
          <Button className="mt-4" onClick={renderVideo} disabled={rendering}>
            <RefreshCw className="h-4 w-4" /> Retry render
          </Button>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold">{value}</dd>
    </div>
  );
}
