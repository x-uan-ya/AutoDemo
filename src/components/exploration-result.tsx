import {
  ExternalLink,
  Heading1,
  MousePointerClick,
  LinkIcon,
  FormInput,
  Navigation,
  Globe,
} from "lucide-react";
import type { WebsiteExploration } from "@/lib/browser/types";
import { displayHost } from "@/lib/utils";

/**
 * Read-only presentation of a WebsiteExploration result. Used on the Create
 * page after the explorer runs. Purely display; no interaction with the
 * explored site.
 */
export function ExplorationResult({ data }: { data: WebsiteExploration }) {
  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">
              {data.title || "Untitled page"}
            </h2>
            <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted-foreground">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              {displayHost(data.finalUrl)}
            </p>
          </div>
          {data.statusCode != null && (
            <span className="shrink-0 rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              HTTP {data.statusCode}
            </span>
          )}
        </div>
        {data.description && (
          <p className="mt-3 text-sm text-muted-foreground">
            {data.description}
          </p>
        )}
        {data.finalUrl !== data.url && (
          <p className="mt-3 text-xs text-muted-foreground">
            Redirected from {data.url}
          </p>
        )}
      </div>

      {/* Screenshots */}
      {data.screenshots.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-6">
          <SectionTitle icon={Globe} label="Screenshots" />
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {data.screenshots.map((shot) => (
              <figure key={shot.kind} className="overflow-hidden rounded-lg border border-border">
                <div className="max-h-80 overflow-y-auto bg-muted">
                  {/* Explorer returns a data: URL PNG. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.dataUrl}
                    alt={`${shot.kind} screenshot`}
                    className="w-full"
                  />
                </div>
                <figcaption className="border-t border-border px-3 py-2 text-xs capitalize text-muted-foreground">
                  {shot.kind === "fullPage" ? "Full page" : "Viewport"}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <CountList
          icon={Heading1}
          label="Headings"
          items={data.headings.map((h) => `H${h.level} · ${h.text}`)}
        />
        <CountList
          icon={MousePointerClick}
          label="Buttons"
          items={data.buttons.map((b) => b.text)}
        />
        <CountList
          icon={Navigation}
          label="Navigation"
          items={data.navigation.map((n) => n.text)}
        />
        <LinkList links={data.links} />
        <FormList forms={data.forms} />
      </div>
    </div>
  );
}

function SectionTitle({
  icon: Icon,
  label,
  count,
}: {
  icon: typeof Globe;
  label: string;
  count?: number;
}) {
  return (
    <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
      <Icon className="h-4 w-4" />
      {label}
      {count != null && (
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground">
          {count}
        </span>
      )}
    </h3>
  );
}

function CountList({
  icon,
  label,
  items,
}: {
  icon: typeof Globe;
  label: string;
  items: string[];
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <SectionTitle icon={icon} label={label} count={items.length} />
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">None found.</p>
      ) : (
        <ul className="mt-4 space-y-1.5 text-sm">
          {items.slice(0, 25).map((item, i) => (
            <li key={i} className="truncate text-foreground">
              {item}
            </li>
          ))}
          {items.length > 25 && (
            <li className="text-xs text-muted-foreground">
              +{items.length - 25} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function LinkList({ links }: { links: WebsiteExploration["links"] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <SectionTitle icon={LinkIcon} label="Links" count={links.length} />
      {links.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">None found.</p>
      ) : (
        <ul className="mt-4 space-y-1.5 text-sm">
          {links.slice(0, 25).map((link, i) => (
            <li key={i} className="flex items-center gap-1.5 truncate">
              <span className="truncate text-foreground">{link.text}</span>
              {link.external && (
                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
              )}
            </li>
          ))}
          {links.length > 25 && (
            <li className="text-xs text-muted-foreground">
              +{links.length - 25} more
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function FormList({ forms }: { forms: WebsiteExploration["forms"] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <SectionTitle icon={FormInput} label="Forms" count={forms.length} />
      {forms.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">None found.</p>
      ) : (
        <ul className="mt-4 space-y-3 text-sm">
          {forms.map((form, i) => (
            <li key={i} className="rounded-lg border border-border p-3">
              <p className="font-medium">
                {form.method} form · {form.fields.length} field
                {form.fields.length === 1 ? "" : "s"}
              </p>
              {form.fields.length > 0 && (
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {form.fields
                    .map((f) => f.label || f.name || f.type)
                    .filter(Boolean)
                    .join(", ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
