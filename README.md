# AutoDemo

Turn any website into a narrated product demo video.

AutoDemo lets a user enter a deployed website URL and configure a demo. The
long-term goal is a system that explores the site, identifies important
features, plans a walkthrough storyboard, generates narration, records the site
with browser automation, and renders a final video.

> **Milestone status: foundation + UI + Website Explorer.** This repository
> contains the application shell, pages, reusable components, the data model,
> and the first real backend capability: a Playwright-based Website Explorer
> that opens a public site and collects a passive snapshot of it. It does not
> yet perform AI processing, autonomous browser interaction, text-to-speech, or
> video rendering.

## Current functionality

- **Landing page** (`/`) — hero, primary/secondary calls to action, and a
  four-step overview of the intended workflow.
- **Dashboard** (`/dashboard`) — lists demo projects (seeded mock data) with
  website, purpose, duration, language, status, created date, and a view link.
  Shows an empty state when there are no projects.
- **Create Demo** (`/create`) — a form for website URL, purpose, audience,
  duration, language, voice, and optional instructions. Clicking **Generate
  Demo** POSTs the URL to `/api/explore`, shows an "Exploring website..." state,
  then renders the structured data the Website Explorer collected (see below).
- **Demo detail** (`/demo/[id]`) — project information, a `Ready for
  Exploration` status, and a display-only generation pipeline (Website
  Analysis → Feature Discovery → Demo Planning → Recording → Voice Generation →
  Video Rendering → Completed).

## Tech stack

- [Next.js 16](https://nextjs.org/) (App Router) with **TypeScript** and **React 19**
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Zod](https://zod.dev/) for validation
- [lucide-react](https://lucide.dev/) icons
- `class-variance-authority`, `clsx`, `tailwind-merge` for component styling
  (shadcn/ui-style primitives)
- **PostgreSQL-ready** persistence boundary (see below)

## Project structure

```
src/
  app/
    layout.tsx            Root layout (Navbar)
    page.tsx              Landing page
    globals.css           Theme tokens + Tailwind layers
    (app)/                App shell (adds Sidebar)
      layout.tsx
      dashboard/page.tsx
      create/page.tsx
      demo/[id]/page.tsx
      demo/[id]/not-found.tsx
    api/
      explore/route.ts    POST /api/explore — runs the Website Explorer
  components/
    layout/navbar.tsx
    layout/sidebar.tsx
    ui/button.tsx
    ui/status-badge.tsx
    demo-card.tsx
    progress-pipeline.tsx
    demo-settings.tsx
    empty-state.tsx
    create-demo-form.tsx     Calls /api/explore, shows progress + results
    exploration-result.tsx   Renders collected website data
  data/
    mock-jobs.ts          Seed data for the dashboard
  lib/
    browser/
      types.ts            Explorer result types + ExplorerError
      url-validator.ts    Server-side SSRF-safe URL validation
      browser-explorer.ts Playwright passive exploration service
    options.ts            Option lists + human-readable labels
    validation.ts         Zod schema (single source of truth for the form)
    repository.ts         DemoJobRepository interface + in-memory impl
    pipeline.ts           Initial pipeline construction
    utils.ts              cn(), formatDate(), displayHost()
  types/
    index.ts              Domain types (DemoJob, DemoSettings, etc.)
```

## Website Explorer

The first real backend capability. Given a public `https://` URL, AutoDemo
opens the site in headless Chromium (via Playwright) and collects a **passive**
snapshot — it reads what the page renders but never clicks, types, or submits.

Collected data (`WebsiteExploration`): final URL, page title, meta description,
visible headings, buttons, links, forms, navigation, and both viewport and
full-page screenshots (returned as base64 PNG data URLs).

Endpoint:

```
POST /api/explore
Request:  { "url": "https://example.com" }
Response: { "success": true, "data": { ...WebsiteExploration } }
      or  { "success": false, "error": { "code", "message" } }
```

**Security (SSRF protection).** `url-validator.ts` runs server-side and rejects
anything that is not a public `https://` host: non-https schemes
(`http`, `file:`, `javascript:`, `data:`), `localhost` / `*.local` /
`*.internal`, literal loopback/private/link-local/unique-local/CGNAT/multicast
IPs, and cloud metadata addresses (e.g. `169.254.169.254`). Hostnames are
resolved via DNS and every resolved address is checked, so a public-looking name
that points at an internal IP is also rejected. The final URL after redirects is
re-validated before any data is returned.

No LLM is involved. This milestone proves the path USER → URL → Playwright →
website data works reliably.

## Planned architecture

The code is organized so future capabilities can be added without rewrites:

- **Persistence.** All data access goes through the `DemoJobRepository`
  interface in `src/lib/repository.ts`. Today the only implementation is an
  in-memory store seeded from `src/data/mock-jobs.ts`. A PostgreSQL-backed
  implementation can implement the same interface and be returned from
  `getRepository()` with no changes to pages or components. `DATABASE_URL` is
  already reserved in `.env.example`.
- **Domain model.** `src/types/index.ts` already describes the full intended
  shape — `DemoJob`, `DemoSettings`, `DiscoveredFeature`, `DemoScene`,
  `BrowserAction`, and `VideoAsset` — including stages not yet implemented, so
  later layers have a stable target.
- **Pipeline.** The generation pipeline stages are modeled as data
  (`PipelineStage` + `PipelineStageState`). The UI renders whatever state the
  repository provides, so wiring real processing is a matter of updating stage
  status as work progresses.
- **Future layers** (browser automation, AI planning, TTS, video rendering)
  each map to a pipeline stage and a set of domain artifacts. Their credentials
  are placeholdered in `.env.example`.

## Running locally

Prerequisites: Node.js 20.9+ (Next.js 16 requirement) and npm.

```bash
# 1. Install dependencies
npm install

# 1a. Install the Playwright Chromium browser (needed by the Website Explorer)
npx playwright install chromium

# 2. (Optional) copy environment defaults
cp .env.example .env.local

# 3. Start the dev server
npm run dev
```

Then open http://localhost:3000.

Other useful scripts:

```bash
npm run build      # production build
npm run start      # run the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

## Not included yet (intentionally)

- No authentication.
- No AI/LLM, text-to-speech, or video generation.
- No autonomous browser interaction. The explorer is passive (read-only): it
  does not click, type, or submit.
- No mobile-optimized layouts (desktop-first for this milestone).
- No production database (in-memory store only).
