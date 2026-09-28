import Link from "next/link";
import { Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Top navigation bar. Present on every page via the root layout. Keeps global
 * actions (brand, primary CTA) in a consistent place.
 */
export function Navbar() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="container flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-lg">AutoDemo</span>
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <Link href="/dashboard" className="hover:text-foreground">
            Dashboard
          </Link>
          <Link href="/create" className="hover:text-foreground">
            Create
          </Link>
        </nav>

        <Link
          href="/create"
          className={cn(buttonVariants({ size: "sm" }))}
        >
          Create a Demo
        </Link>
      </div>
    </header>
  );
}
