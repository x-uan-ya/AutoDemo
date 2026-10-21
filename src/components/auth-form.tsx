"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/auth/client";

interface AuthFormProps {
  mode: "login" | "register";
  /** Where to send the user after success (sanitized to a same-site path). */
  next?: string;
}

/** Only allow same-site absolute paths as redirect targets (open-redirect guard). */
function safeNext(next?: string): string {
  if (!next) return "/dashboard";
  if (!next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export function AuthForm({ mode, next }: AuthFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";
  const endpoint = isRegister ? "/api/auth/register" : "/api/auth/login";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json?.error?.message ?? "Something went wrong. Please try again.");
        return;
      }
      // Refresh so server components pick up the new session cookie.
      router.push(safeNext(next));
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete={isRegister ? "new-password" : "current-password"}
          required
          minLength={isRegister ? 8 : undefined}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        {isRegister && (
          <p className="mt-1 text-xs text-muted-foreground">
            At least 8 characters.
          </p>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-500" role="alert">
          {error}
        </p>
      )}

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isRegister ? "Create account" : "Sign in"}
      </Button>

      <p className="text-center text-sm text-muted-foreground">
        {isRegister ? (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground hover:underline">
              Sign in
            </Link>
          </>
        ) : (
          <>
            New to AutoDemo?{" "}
            <Link href="/register" className="font-medium text-foreground hover:underline">
              Create an account
            </Link>
          </>
        )}
      </p>
    </form>
  );
}
