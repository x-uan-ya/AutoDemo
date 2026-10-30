"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/auth/client";
import {
  DURATION_OPTIONS,
  LANGUAGE_OPTIONS,
  PURPOSE_OPTIONS,
  VOICE_OPTIONS,
} from "@/lib/options";

const fieldClass =
  "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";
const labelClass = "text-sm font-medium";
const errorClass = "mt-1 text-xs text-red-600";

interface ApiErrorBody {
  code: string;
  message: string;
}

type Phase = "idle" | "creating" | "error";

/**
 * Create-demo form.
 *
 * "Generate Demo" creates a demo job (POST /api/demo) owned by the signed-in
 * user from these settings, then navigates to that demo's detail page, where
 * the explore -> discover -> plan -> actions -> record pipeline runs (the
 * recording step produces the video).
 */
export function CreateDemoForm() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [apiError, setApiError] = useState<ApiErrorBody | null>(null);

  const busy = phase === "creating";

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFieldError(null);
    setApiError(null);

    const form = e.currentTarget;
    const data = new FormData(form);
    const url = String(data.get("websiteUrl") ?? "").trim();

    // Lightweight client-side check; the server does the authoritative
    // (security) validation.
    if (!url) {
      setFieldError("Website URL is required");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      setFieldError("Enter a public URL starting with http:// or https://");
      return;
    }

    setPhase("creating");
    try {
      const res = await apiFetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteUrl: url,
          purpose: String(data.get("purpose") ?? "product_overview"),
          audience: String(data.get("audience") ?? ""),
          duration: String(data.get("duration") ?? "60s"),
          language: String(data.get("language") ?? "english"),
          voice: String(data.get("voice") ?? "professional_female"),
          additionalInstructions: String(data.get("additionalInstructions") ?? ""),
        }),
      });
      const json = await res.json();

      if (!res.ok || !json.success) {
        if (res.status === 401) {
          // Session expired / not signed in — send them to login.
          router.push("/login?next=/create");
          return;
        }
        setApiError(
          json?.error ?? {
            code: "error",
            message: "Could not create the demo. Please try again.",
          }
        );
        setPhase("error");
        return;
      }

      // Land on the new demo's detail page to run the pipeline.
      router.push(`/demo/${json.data.id}`);
    } catch {
      setApiError({
        code: "network_error",
        message: "Could not reach the server. Check your connection and retry.",
      });
      setPhase("error");
    }
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="websiteUrl" className={labelClass}>
            Website URL
          </label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            placeholder="https://example.com"
            className={fieldClass}
            disabled={busy}
          />
          {fieldError && <p className={errorClass}>{fieldError}</p>}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <label htmlFor="purpose" className={labelClass}>
              Demo purpose
            </label>
            <select id="purpose" name="purpose" className={fieldClass} defaultValue="product_overview" disabled={busy}>
              {PURPOSE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="audience" className={labelClass}>
              Audience
            </label>
            <input
              id="audience"
              name="audience"
              type="text"
              placeholder="e.g. Prospective customers"
              className={fieldClass}
              disabled={busy}
            />
          </div>

          <div>
            <label htmlFor="duration" className={labelClass}>
              Duration
            </label>
            <select id="duration" name="duration" className={fieldClass} defaultValue="60s" disabled={busy}>
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="language" className={labelClass}>
              Language
            </label>
            <select id="language" name="language" className={fieldClass} defaultValue="english" disabled={busy}>
              {LANGUAGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="voice" className={labelClass}>
              Voice
            </label>
            <select id="voice" name="voice" className={fieldClass} defaultValue="professional_female" disabled={busy}>
              {VOICE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="additionalInstructions" className={labelClass}>
            Additional instructions{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="additionalInstructions"
            name="additionalInstructions"
            rows={4}
            placeholder="Anything specific you want the demo to highlight?"
            className={fieldClass}
            disabled={busy}
          />
        </div>

        {phase === "error" && apiError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {apiError.message}
          </p>
        )}

        <Button type="submit" size="lg" disabled={busy}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Generate Demo
        </Button>
      </form>

      {busy && <CreatingState />}
    </div>
  );
}

function CreatingState() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-accent/40 px-4 py-4 text-sm">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Compass className="h-4 w-4 animate-pulse" />
      </span>
      <div>
        <p className="font-medium">Creating your demo...</p>
        <p className="text-muted-foreground">
          Setting up the project. You&apos;ll be taken to its page to run the
          generation pipeline.
        </p>
      </div>
      <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}
