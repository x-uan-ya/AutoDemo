import { redirect } from "next/navigation";
import { CreateDemoForm } from "@/components/create-demo-form";
import { getCurrentUser } from "@/lib/auth/server";

export const metadata = {
  title: "Create Demo — AutoDemo",
};

export default async function CreatePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/create");

  return (
    <div className="mx-auto max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Create a Demo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe the demo you want. AutoDemo will create a project you can
          take through the generation pipeline.
        </p>
      </div>

      <div className="mt-8 rounded-xl border border-border bg-card p-6 sm:p-8">
        <CreateDemoForm />
      </div>
    </div>
  );
}
