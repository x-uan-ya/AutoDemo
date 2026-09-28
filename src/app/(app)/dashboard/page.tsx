import Link from "next/link";
import { LayoutDashboard } from "lucide-react";
import { DemoCard } from "@/components/demo-card";
import { EmptyState } from "@/components/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getRepository } from "@/lib/repository";

export const metadata = {
  title: "Dashboard — AutoDemo",
};

export default async function DashboardPage() {
  const jobs = await getRepository().list();

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Your Demos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Previously created demo projects.
          </p>
        </div>
        <Link href="/create" className={cn(buttonVariants({ size: "sm" }))}>
          New Demo
        </Link>
      </div>

      {jobs.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={LayoutDashboard}
            title="No demos yet"
            description="Create your first demo to see it appear here."
            actionLabel="Create a Demo"
            actionHref="/create"
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <DemoCard key={job.id} job={job} />
          ))}
        </div>
      )}
    </div>
  );
}
