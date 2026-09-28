"use client";

import { useEffect, useRef, useState } from "react";
import {
  Clapperboard,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Film,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatSeconds } from "@/lib/utils";
import type { RecordingResult } from "@/lib/browser/types";

interface ApiError {
  code: string;
  message: string;
}

type Phase = "idle" | "recording" | "complete" | "failed";

/**
 * Phase 5 recording UI.
 *
 * Shows a "Generate Browser Recording" button (enabled only when the browser
 * actions are approved). While recording, it walks through progress messages
 * (Preparing browser -> Recording scene N -> Finalizing). On success it embeds
 * a video player; on failure it shows the captured error context.
 *
 * Note: the record API is a single request; progress here is a client-side
 * approximation timed to the scene count. The final result is authoritative.
 */
export function RecordingPanel({
  jobId,
  actionsApproved,
  sceneTitles,
  initialRecording,
}: {
  jobId: string;
  actionsApproved: boolean;
  sceneTitles: string[];
  initialRecording?: RecordingResult;
}) {
  const [phase, setPhase] = useState<Phase>(
    initialRecording
      ? initialRecording.success
        ? "complete"
        : "failed"
      : "idle"
  );
  const [recording, setRecording] = useState<RecordingResult | undefined>(
    initialRecording
  );
  const [error, setError] = useState<ApiError | null>(null);
  const [progress, setProgress] = useState<string>("");
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (progressTimer.current) clearInterval(progressTimer.current);
    };
  }, []);

  function startProgressSimulation() {
    const steps = [
      "Preparing browser...",
      ...sceneTitles.map((t, i) => `Recording scene ${i + 1}${t ? `: ${t}` : ""}...`),
      "Finalizing recording...",
    ];
    let i = 0;
    setProgress(steps[0]);
    progressTimer.current = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setProgress(steps[i]);
    }, 1500);
  }

  function stopProgressSimulation() {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }

  async function record() {
    setPhase("recording");
    setError(null);
    setRecording(undefined);
    startProgressSimulation();
    try {
      const res = await fetch(`/api/demo/${jobId}/record`, { method: "POST" });
      const json = await res.json();
      stopProgressSimulation();

      if (res.status === 409) {
        setError(json?.error ?? { code: "conflict", message: "Not ready to record." });
        setPhase("idle");
        return;
      }

      // Build a RecordingResult-like view from the response for display.
      const result: RecordingResult = {
        success: !!json.success,
        videoPath: json.videoPath ?? null,
        duration: json.duration ?? 0,
        scenes: json.scenes ?? [],
        screenshots: [],
        errors: json.errors ?? [],
        recordedAt: new Date().toISOString(),
        viewport: { width: 0, height: 0 },
      };
      setRecording(result);
      setPhase(result.success ? "complete" : "failed");
      if (!result.success && result.errors.length === 0) {
        setError(json?.error ?? { code: "failed", message: "Recording failed." });
      }
    } catch {
      stopProgressSimulation();
      setError({ code: "network", message: "Could not reach the server." });
      setPhase("idle");
    }
  }

  const recordingNow = phase === "recording";

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Film className="h-4 w-4" />
            Browser Recording
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Execute the approved actions in a real browser and capture a video.
            No voice is added at this stage.
          </p>
        </div>
        <Button
          onClick={record}
          disabled={!actionsApproved || recordingNow}
          size="sm"
          variant={recording ? "outline" : "primary"}
        >
          {recordingNow && <Loader2 className="h-4 w-4 animate-spin" />}
          {recording ? "Re-record" : "Generate Browser Recording"}
        </Button>
      </div>

      {!actionsApproved && !recording && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Approve the browser actions first, then generate a recording.
        </div>
      )}

      {recordingNow && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-accent/40 px-4 py-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <p className="font-medium">{progress || "Recording..."}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {phase === "complete" && recording && (
        <div className="mt-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-green-700">
            <CheckCircle2 className="h-4 w-4" />
            Browser recording ready
            <span className="text-muted-foreground">
              · {formatSeconds(Math.round(recording.duration / 1000))}
            </span>
          </p>
          {recording.videoPath ? (
            <video
              src={recording.videoPath}
              controls
              className="w-full rounded-lg border border-border bg-black"
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Recording completed but no video path was returned.
            </p>
          )}
          <SceneResults scenes={recording.scenes} />
        </div>
      )}

      {phase === "failed" && recording && (
        <div className="mt-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-red-700">
            <AlertCircle className="h-4 w-4" />
            Recording failed
          </p>
          {recording.errors.length > 0 && (
            <ul className="space-y-2">
              {recording.errors.map((e, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                >
                  <p className="font-medium">{e.action}</p>
                  <p className="mt-0.5">{e.message}</p>
                  {e.screenshotPath && (
                    <a
                      href={e.screenshotPath}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex items-center gap-1 text-xs underline"
                    >
                      <Camera className="h-3 w-3" /> failure screenshot
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
          <SceneResults scenes={recording.scenes} />
        </div>
      )}
    </div>
  );
}

function SceneResults({
  scenes,
}: {
  scenes: RecordingResult["scenes"];
}) {
  if (scenes.length === 0) return null;
  return (
    <ol className="mt-4 space-y-2">
      {scenes.map((s) => (
        <li
          key={s.sceneId}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm"
        >
          {s.success ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
          )}
          <span className="font-medium">
            Scene {s.order}: {s.title}
          </span>
          <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
            <Clapperboard className="h-3 w-3" />
            {s.screenshotPaths.length} shot
            {s.screenshotPaths.length === 1 ? "" : "s"}
          </span>
        </li>
      ))}
    </ol>
  );
}
