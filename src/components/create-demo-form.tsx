"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DURATION_OPTIONS,
  LANGUAGE_OPTIONS,
  PURPOSE_OPTIONS,
  VOICE_OPTIONS,
} from "@/lib/options";
import {
  createDemoAction,
  type CreateDemoState,
} from "@/app/(app)/create/actions";

const initialState: CreateDemoState = {};

const fieldClass =
  "mt-1.5 block w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium";
const errorClass = "mt-1 text-xs text-red-600";

/**
 * Create-demo form. Submits to the createDemoAction server action, which
 * validates with Zod, creates a mock job, and redirects to its detail page.
 * No AI/automation is invoked in this milestone.
 */
export function CreateDemoForm() {
  const [state, formAction] = useActionState(createDemoAction, initialState);
  const errors = state.errors ?? {};

  return (
    <form action={formAction} className="space-y-6">
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
        />
        {errors.websiteUrl && <p className={errorClass}>{errors.websiteUrl}</p>}
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="purpose" className={labelClass}>
            Demo purpose
          </label>
          <select id="purpose" name="purpose" className={fieldClass} defaultValue="product_overview">
            {PURPOSE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errors.purpose && <p className={errorClass}>{errors.purpose}</p>}
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
          />
          {errors.audience && <p className={errorClass}>{errors.audience}</p>}
        </div>

        <div>
          <label htmlFor="duration" className={labelClass}>
            Duration
          </label>
          <select id="duration" name="duration" className={fieldClass} defaultValue="60s">
            {DURATION_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errors.duration && <p className={errorClass}>{errors.duration}</p>}
        </div>

        <div>
          <label htmlFor="language" className={labelClass}>
            Language
          </label>
          <select id="language" name="language" className={fieldClass} defaultValue="english">
            {LANGUAGE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errors.language && <p className={errorClass}>{errors.language}</p>}
        </div>

        <div>
          <label htmlFor="voice" className={labelClass}>
            Voice
          </label>
          <select id="voice" name="voice" className={fieldClass} defaultValue="professional_female">
            {VOICE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {errors.voice && <p className={errorClass}>{errors.voice}</p>}
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
        />
        {errors.additionalInstructions && (
          <p className={errorClass}>{errors.additionalInstructions}</p>
        )}
      </div>

      {state.message && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.message}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending}>
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      Generate Demo
    </Button>
  );
}
