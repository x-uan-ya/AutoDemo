import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/server";

export const metadata = { title: "Sign in — AutoDemo" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  // Already signed in: skip the form.
  const user = await getCurrentUser();
  if (user) redirect(next && next.startsWith("/") ? next : "/dashboard");

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign in to access your demos.
      </p>
      <div className="mt-8">
        <AuthForm mode="login" next={next} />
      </div>
    </div>
  );
}
