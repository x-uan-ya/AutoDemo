import {
  DURATION_OPTIONS,
  LANGUAGE_OPTIONS,
  PURPOSE_OPTIONS,
  VOICE_OPTIONS,
  labelFor,
} from "@/lib/options";
import type { DemoSettings as DemoSettingsType } from "@/types";

/**
 * Read-only presentation of a demo's configured settings. Used on the detail
 * page to summarize how the demo was requested.
 */
export function DemoSettings({ settings }: { settings: DemoSettingsType }) {
  const rows: { label: string; value: string }[] = [
    { label: "Website URL", value: settings.websiteUrl },
    { label: "Purpose", value: labelFor(PURPOSE_OPTIONS, settings.purpose) },
    { label: "Audience", value: settings.audience },
    { label: "Duration", value: labelFor(DURATION_OPTIONS, settings.duration) },
    { label: "Language", value: labelFor(LANGUAGE_OPTIONS, settings.language) },
    { label: "Voice", value: labelFor(VOICE_OPTIONS, settings.voice) },
  ];

  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Project Information
      </h2>
      <dl className="mt-4 divide-y divide-border">
        {rows.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-3 gap-4 py-3 text-sm"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="col-span-2 break-words font-medium">{row.value}</dd>
          </div>
        ))}
        {settings.additionalInstructions ? (
          <div className="grid grid-cols-3 gap-4 py-3 text-sm">
            <dt className="text-muted-foreground">Additional Instructions</dt>
            <dd className="col-span-2 whitespace-pre-wrap break-words font-medium">
              {settings.additionalInstructions}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
