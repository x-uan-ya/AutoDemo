"use client";

import { useRef, useState } from "react";
import {
  Mic,
  Loader2,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatSeconds } from "@/lib/utils";
import { LANGUAGE_OPTIONS, VOICE_OPTIONS, labelFor } from "@/lib/options";
import type { DemoLanguage } from "@/types";
import type { VoiceOver, SceneAudio } from "@/lib/tts/types";

interface ApiError {
  code: string;
  message: string;
}

type Phase = "idle" | "generating" | "done";

const SUPPORTED_LANGUAGES: DemoLanguage[] = ["english", "mandarin"];

/**
 * Phase 6 voice UI.
 *
 * "Generate Voice" synthesizes narration audio for every scene (POST), shows
 * progress, then renders an audio player per scene. Individual scenes can be
 * regenerated (PATCH). Failed scenes are shown with a retry, and successful
 * scenes are preserved across retries. Audio is NOT merged with the video here.
 */
export function VoicePanel({
  jobId,
  storyboardApproved,
  language,
  voice,
  sceneCount,
  initialVoiceOver,
}: {
  jobId: string;
  storyboardApproved: boolean;
  language: DemoLanguage;
  voice: string;
  sceneCount: number;
  initialVoiceOver?: VoiceOver;
}) {
  const [voiceOver, setVoiceOver] = useState<VoiceOver | undefined>(
    initialVoiceOver
  );
  const [phase, setPhase] = useState<Phase>(initialVoiceOver ? "done" : "idle");
  const [error, setError] = useState<ApiError | null>(null);
  const [progress, setProgress] = useState("");
  const [regenId, setRegenId] = useState<string | null>(null);
  const progressTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const languageSupported = SUPPORTED_LANGUAGES.includes(language);
  const generating = phase === "generating";

  function startProgress() {
    const steps = [
      "Generating narration...",
      ...Array.from({ length: sceneCount }, (_, i) => `Scene ${i + 1}...`),
    ];
    let i = 0;
    setProgress(steps[0]);
    progressTimer.current = setInterval(() => {
      i = Math.min(i + 1, steps.length - 1);
      setProgress(steps[i]);
    }, 900);
  }
  function stopProgress() {
    if (progressTimer.current) {
      clearInterval(progressTimer.current);
      progressTimer.current = null;
    }
  }

  async function generate() {
    setPhase("generating");
    setError(null);
    startProgress();
    try {
      const res = await fetch(`/api/demo/${jobId}/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      stopProgress();
      if (res.status === 409 || (!res.ok && !json.voiceOver)) {
        setError(json?.error ?? { code: "error", message: "Voice generation failed." });
        setPhase(voiceOver ? "done" : "idle");
        return;
      }
      setVoiceOver(json.voiceOver as VoiceOver);
      setPhase("done");
    } catch {
      stopProgress();
      setError({ code: "network", message: "Could not reach the server." });
      setPhase(voiceOver ? "done" : "idle");
    }
  }

  async function regenerate(sceneId: string) {
    setRegenId(sceneId);
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/voice`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId }),
      });
      const json = await res.json();
      if (json.voiceOver) setVoiceOver(json.voiceOver as VoiceOver);
      if (!res.ok && !json.voiceOver) {
        setError(json?.error ?? { code: "error", message: "Regeneration failed." });
      }
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setRegenId(null);
    }
  }

  const scenes = voiceOver?.scenes ?? [];
  const readyCount = scenes.filter((s) => s.status === "ready").length;

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Mic className="h-4 w-4" />
            Voice Narration
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {voiceOver
              ? `${readyCount} of ${scenes.length} scenes voiced · ${labelFor(
                  LANGUAGE_OPTIONS,
                  language
                )} · ${labelFor(VOICE_OPTIONS, voice)}`
              : `Generate narration audio · ${labelFor(
                  LANGUAGE_OPTIONS,
                  language
                )} · ${labelFor(VOICE_OPTIONS, voice)}`}
          </p>
        </div>
        <Button
          onClick={generate}
          disabled={!storyboardApproved || !languageSupported || generating}
          size="sm"
          variant={voiceOver ? "outline" : "primary"}
        >
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          {voiceOver ? "Regenerate all" : "Generate Voice"}
        </Button>
      </div>

      {!storyboardApproved && !voiceOver && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Approve the storyboard first, then generate voice narration.
        </div>
      )}

      {storyboardApproved && !languageSupported && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Voice currently supports English and Mandarin only. This demo is set
            to {labelFor(LANGUAGE_OPTIONS, language)}.
          </span>
        </div>
      )}

      {generating && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-accent/40 px-4 py-4 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <p className="font-medium">{progress || "Generating narration..."}</p>
        </div>
      )}

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error.message}</span>
        </div>
      )}

      {phase === "done" && scenes.length > 0 && (
        <ol className="mt-5 space-y-3">
          {scenes.map((s) => (
            <SceneAudioRow
              key={s.sceneId}
              scene={s}
              regenerating={regenId === s.sceneId}
              onRegenerate={() => regenerate(s.sceneId)}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function SceneAudioRow({
  scene,
  regenerating,
  onRegenerate,
}: {
  scene: SceneAudio;
  regenerating: boolean;
  onRegenerate: () => void;
}) {
  const failed = scene.status === "failed";
  return (
    <li
      className={cn(
        "rounded-lg border p-4",
        failed ? "border-red-200 bg-red-50" : "border-border"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {failed ? (
              <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
            )}
            <span className="text-sm font-medium">Scene {scene.order}</span>
            {!failed && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Volume2 className="h-3 w-3" />
                {formatSeconds(scene.duration)}
              </span>
            )}
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {scene.text}
          </p>

          {failed ? (
            <p className="mt-2 text-sm text-red-700">
              {scene.error ?? "Voice generation failed for this scene."}
            </p>
          ) : scene.audioPath ? (
            <audio
              src={scene.audioPath}
              controls
              className="mt-2 w-full"
              preload="none"
            />
          ) : null}
        </div>

        <Button
          size="sm"
          variant="outline"
          onClick={onRegenerate}
          disabled={regenerating}
        >
          {regenerating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {failed ? "Retry" : "Regenerate"}
        </Button>
      </div>
    </li>
  );
}
