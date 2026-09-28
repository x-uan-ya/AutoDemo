import Link from "next/link";
import { Globe, Clock, Languages, Target } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { cn, formatDate, displayHost } from "@/lib/utils";
import {
  DURATION_OPTIONS,
  LANGUAGE_OPTIONS,
  PURPOSE_OPTIONS,
  labelFor,
} from "@/lib/options";
import type { DemoJob } from "@/types";

/**
 * Summary card for a single demo project, used on the dashboard grid.
 */
export function DemoCard({ job }: { job: DemoJob }) {
  const { settings } = job;

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{job.title}</h3>
          <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-muted-foreground">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            {displayHost(settings.websiteUrl)}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <Meta icon={Target} label={labelFor(PURPOSE_OPTIONS, settings.purpose)} />
        <Meta
          icon={Clock}
          label={labelFor(DURATION_OPTIONS, settings.duration)}
        />
        <Meta
          icon={Languages}
          label={labelFor(LANGUAGE_OPTIONS, settings.language)}
        />
      </dl>

      <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">
          {formatDate(job.createdAt)}
        </span>
        <Link
          href={`/demo/${job.id}`}
          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
        >
          View
        </Link>
      </div>
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
}: {
  icon: typeof Globe;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate text-foreground">{label}</span>
    </div>
  );
}
