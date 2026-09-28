"use client";

import { useState } from "react";
import {
  Languages,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, formatSeconds } from "@/lib/utils";
import {
  SUPPORTED_DEMO_LANGUAGES,
  type DemoLanguageCode,
} from "@/lib/i18n/demo-language";
import type { LanguageVersion, Multilingual } from "@/lib/i18n/types";

interface ApiError {
  code: string;
  message: string;
}

/**
 * Phase 8 multilingual UI.
 *
 * Shows a language selector (English / 中文) and a "Generate <language> Demo"
 * button per language. Each generated language is shown separately with its own
 * video player and download. The same browser recording is reused; only the
 * narration/audio/captions/video differ by language.
 */
export function MultilingualPanel({
  jobId,
  canGenerate,
  initialMultilingual,
}: {
  jobId: string;
  canGenerate: boolean;
  initialMultilingual?: Multilingual;
}) {
  const [versions, setVersions] = useState<LanguageVersion[]>(
    initialMultilingual?.languageVersions ?? []
  );
  const [selected, setSelected] = useState<DemoLanguageCode>("en");
  const [busyLang, setBusyLang] = useState<DemoLanguageCode | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  function versionFor(code: DemoLanguageCode): LanguageVersion | undefined {
    return versions.find((v) => v.language === code);
  }

  async function generate(code: DemoLanguageCode) {
    setBusyLang(code);
    setError(null);
    try {
      const res = await fetch(`/api/demo/${jobId}/language/${code}`, {
        method: "POST",
      });
      const json = await res.json();
      if (res.status === 409 || (!res.ok && !json.videoPath && !json.status)) {
        setError(json?.error ?? { code: "error", message: "Generation failed." });
        return;
      }
      const version: LanguageVersion = {
        language: code,
        scenes: [],
        videoPath: json.videoPath ?? null,
        videoDuration: json.videoDuration ?? 0,
        status: json.status ?? (json.success ? "ready" : "failed"),
        reusedRecording: !!json.reusedRecording,
        error: json?.error?.message ?? json?.error,
        provider: "-",
        generatedAt: new Date().toISOString(),
      };
      setVersions((prev) => [
        ...prev.filter((v) => v.language !== code),
        version,
      ]);
      if (version.status !== "ready" && version.error) {
        setError({ code: "failed", message: version.error });
      }
    } catch {
      setError({ code: "network", message: "Could not reach the server." });
    } finally {
      setBusyLang(null);
    }
  }

  const selectedDef = SUPPORTED_DEMO_LANGUAGES.find(
    (l) => l.languageCode === selected
  )!;
  const selectedVersion = versionFor(selected);

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          <Languages className="h-4 w-4" />
          Languages
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate the same demo in multiple languages. The browser recording is
          reused — only narration, audio, captions, and the video change.
        </p>
      </div>

      {!canGenerate && (
        <div className="mt-5 rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Approve the storyboard and generate a browser recording first, then
          generate language versions.
        </div>
      )}

      {canGenerate && (
        <>
          {/* Language selector */}
          <div className="mt-5 flex flex-wrap gap-2">
            {SUPPORTED_DEMO_LANGUAGES.map((lang) => {
              const v = versionFor(lang.languageCode);
              const isSel = selected === lang.languageCode;
              return (
                <button
                  key={lang.languageCode}
                  onClick={() => setSelected(lang.languageCode)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors",
                    isSel
                      ? "border-primary bg-accent/40"
                      : "border-border hover:bg-secondary/60"
                  )}
                >
                  {lang.nativeName}
                  {v?.status === "ready" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                  )}
                  {v?.status === "failed" && (
                    <AlertCircle className="h-3.5 w-3.5 text-red-600" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Selected language actions + preview */}
          <div className="mt-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-medium">
                {selectedDef.displayName} demo
              </p>
              <Button
                size="sm"
                onClick={() => generate(selected)}
                disabled={busyLang !== null}
                variant={selectedVersion?.status === "ready" ? "outline" : "primary"}
              >
                {busyLang === selected && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {selectedVersion?.status === "ready"
                  ? "Regenerate"
                  : `Generate ${selectedDef.displayName} Demo`}
              </Button>
            </div>

            {busyLang === selected && (
              <div className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-accent/40 px-4 py-4 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <div>
                  <p className="font-medium">
                    Generating {selectedDef.displayName} demo...
                  </p>
                  <p className="text-muted-foreground">
                    Translating narration, synthesizing voice, and rendering —
                    reusing the existing recording.
                  </p>
                </div>
              </div>
            )}

            {error && busyLang === null && (
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error.message}</span>
              </div>
            )}

            {selectedVersion?.status === "ready" && selectedVersion.videoPath && (
              <div className="mt-4">
                <video
                  src={selectedVersion.videoPath}
                  controls
                  className="w-full rounded-lg border border-border bg-black"
                />
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-foreground">
                    {formatSeconds(Math.round(selectedVersion.videoDuration))}
                    {selectedVersion.reusedRecording && " · reused recording"}
                  </span>
                  <a
                    href={selectedVersion.videoPath}
                    download={`demo-${selected}.mp4`}
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    <Download className="h-4 w-4" /> Download
                  </a>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generate(selected)}
                    disabled={busyLang !== null}
                  >
                    <RefreshCw className="h-4 w-4" /> Regenerate
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Summary of all generated languages */}
          {versions.length > 0 && (
            <div className="mt-6 border-t border-border pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Generated videos
              </p>
              <ul className="mt-2 space-y-1.5">
                {versions.map((v) => {
                  const def = SUPPORTED_DEMO_LANGUAGES.find(
                    (l) => l.languageCode === v.language
                  );
                  return (
                    <li
                      key={v.language}
                      className="flex items-center gap-2 text-sm"
                    >
                      {v.status === "ready" ? (
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                      ) : (
                        <AlertCircle className="h-4 w-4 text-red-600" />
                      )}
                      <span>{def?.displayName ?? v.language}</span>
                      {v.videoPath && (
                        <a
                          href={v.videoPath}
                          className="ml-auto font-mono text-xs text-muted-foreground underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          demo-{v.language}.mp4
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
