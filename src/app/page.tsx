import Link from "next/link";
import { Globe, Compass, Clapperboard, Video } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    icon: Globe,
    title: "Enter your website",
    description: "Paste the URL of your deployed site to get started.",
  },
  {
    icon: Compass,
    title: "AutoDemo explores it",
    description: "The system will navigate your site and map its structure.",
  },
  {
    icon: Clapperboard,
    title: "AI creates the walkthrough",
    description: "A storyboard and narration are planned around key features.",
  },
  {
    icon: Video,
    title: "Receive your video",
    description: "A narrated product demo is rendered and ready to share.",
  },
];

export default function LandingPage() {
  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="container flex flex-col items-center py-20 text-center md:py-28">
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
          AI-powered product demos
        </span>
        <h1 className="mt-6 max-w-3xl text-4xl font-bold tracking-tight md:text-6xl">
          Turn Any Website Into a Demo Video
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted-foreground">
          AutoDemo explores your website, plans the walkthrough, and generates
          a narrated product demo.
        </p>
        <div className="mt-10 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/create"
            className={cn(buttonVariants({ size: "lg" }))}
          >
            Create a Demo
          </Link>
          <Link
            href="/dashboard"
            className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}
          >
            View Demo
          </Link>
        </div>
      </section>

      {/* Workflow */}
      <section className="border-t border-border bg-card/50 py-20">
        <div className="container">
          <h2 className="text-center text-2xl font-bold tracking-tight md:text-3xl">
            How it works
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Four steps from a live URL to a shareable walkthrough.
          </p>

          <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="relative rounded-xl border border-border bg-card p-6"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <step.icon className="h-5 w-5" />
                </span>
                <span className="absolute right-5 top-5 text-2xl font-bold text-border">
                  {index + 1}
                </span>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </main>
  );
}
