import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { DemoSettings } from "@/components/demo-settings";
import { ProgressPipeline } from "@/components/progress-pipeline";
import { FeatureDiscoveryPanel } from "@/components/feature-discovery-panel";
import { StatusBadge } from "@/components/ui/status-badge";
import { getRepository } from "@/lib/repository";
import { displayHost, formatDate } from "@/lib/utils";

export default async function DemoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const job = await getRepository().getById(id);

  if (!job) {
    notFound();
  }

  return (
    <div>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to dashboard
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{job.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {displayHost(job.settings.websiteUrl)} · Created{" "}
            {formatDate(job.createdAt)}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <DemoSettings settings={job.settings} />

          <FeatureDiscoveryPanel
            jobId={job.id}
            initialFeatures={job.features}
            initialMeta={job.discoveryMeta}
          />
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Generation Pipeline
          </h2>
          <div className="mt-6">
            <ProgressPipeline pipeline={job.pipeline} />
          </div>
        </div>
      </div>
    </div>
  );
}
