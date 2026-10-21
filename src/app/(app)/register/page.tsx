import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/server";

export const metadata = { title: "Create account — AutoDemo" };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  const user = await getCurrentUser();
  if (user) redirect(next && next.startsWith("/") ? next : "/dashboard");

  return (
    <div className="mx-auto max-w-sm py-12">
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Sign up to create and manage your demos.
      </p>
      <div className="mt-8">
        <AuthForm mode="register" next={next} />
      </div>
    </div>
  );
}
