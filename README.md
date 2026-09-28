# AutoDemo

Turn any website into a narrated product demo video.

AutoDemo lets a user enter a deployed website URL and configure a demo. The
long-term goal is a system that explores the site, identifies important
features, plans a walkthrough storyboard, generates narration, records the site
with browser automation, and renders a final video.

> **Milestone status: foundation + Website Explorer + AI Feature Discovery +
> Demo Planner + Browser Action Engine + Browser Recording + Voice Narration.**
> This repository
> contains the application shell, pages, reusable components, the data model, a
> Playwright-based Website Explorer (passive snapshot of a site), an AI Feature
> Discovery stage (evidence-grounded feature list from a multimodal LLM), a Demo
> Planner that turns selected features into an editable, duration-aware,
> purpose-differentiated storyboard with an approval gate, a Browser Action
> Engine that converts an approved storyboard into safe, allowlisted browser
> actions, a deterministic Browser Recorder that executes those actions in
> Playwright and produces a video, and per-scene Voice Narration (TTS) for the
> storyboard. It does not yet merge audio with video, or perform captions or
> video composition/rendering.

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

No LLM is involved in exploration. It proves the path USER → URL → Playwright →
website data works reliably.

## Feature Discovery (AI)

The second backend capability. It takes the `WebsiteExploration` (page data +
screenshots) and asks a **multimodal** LLM to identify the product's features,
returning a structured, evidence-grounded list.

Each feature includes: `name`, `description`, `importance` (0–1), `confidence`
(0–1), `evidence` (observed headings/buttons/links/forms/screenshot elements),
and `safeToDemo` (whether it can be shown by passive navigation, i.e. no login,
payment, or destructive submit).

**Evidence rule.** The prompt (`src/lib/ai/prompts.ts`) instructs the model to
report only features supported by observable evidence and to never invent
backend functionality. Every feature must cite its evidence. The model's output
is forced through a tool schema and then re-validated with Zod
(`src/lib/ai/schemas.ts`) before it enters the app.

**Provider abstraction.** Callers depend only on the `MultimodalAiProvider`
interface (`src/lib/ai/client.ts`). Two implementations ship:

- `BedrockAiProvider` — Amazon Bedrock Converse API (Claude, multimodal + tool
  use). Used when an AWS region is configured or `AUTODEMO_AI_PROVIDER=bedrock`.
- `MockAiProvider` — a deterministic, evidence-only fallback used when no cloud
  credentials are present, so the app and its flows run with zero setup.

Every call logs usage metadata (provider, model, duration, input/output/total
tokens, estimated cost) via `console.info`. Token/cost are `null` when the
provider does not report them (e.g. the mock).

Endpoints:

```
POST  /api/demo/[id]/discover     Explore the job's site, run discovery, persist
      Response: { success, data: { features, meta } }

PATCH /api/demo/[id]/features     Toggle a feature's selection
      Request:  { "featureId": "feat_...", "selected": true }
```

Discovered features are stored on the `DemoJob` (`features` + `discoveryMeta`)
and displayed on `/demo/[id]`, where each shows its scores, evidence, and a
safe-to-demo badge, and can be selected or deselected for the demo.

> Configure the provider in `.env.local` (see `.env.example`): set `AWS_REGION`
> and optionally `BEDROCK_MODEL_ID` for Bedrock, or `AUTODEMO_AI_PROVIDER=mock`
> to force the offline mock.

## Demo Planner

The third backend capability. It turns the selected features into a
scene-by-scene **storyboard** — a `DemoPlan` of `PlanScene`s, each with
`order`, `featureId`, `title`, `objective`, `narration`, `estimatedDuration`,
`actions` (populated later), and `evidence`.

Key behaviors (`src/lib/planner/`):

- **Respects duration by scene count, not by trimming.** `duration-planner.ts`
  maps the requested length to a target and decides how many features fit (30s
  → 2 scenes, 60s → up to 4, 90s → up to 5, 120s → up to 7). A short demo covers
  fewer, higher-value features rather than cramming a shortened script. It also
  budgets a per-scene word target (~2.5 words/sec) and estimates speaking time.
- **Different purposes produce different plans.** `prompts.ts` carries
  purpose-specific guidance so the same features yield a Hackathon plan
  (innovation, impact), a Customer Tutorial (step-by-step, plain language), a
  Portfolio plan (architecture, implementation), etc.
- **Evidence-grounded narration.** The planner may only use information
  supported by the features' evidence; output is validated with Zod.
- Uses the same `MultimodalAiProvider` abstraction (Bedrock or mock) as
  Feature Discovery.

The storyboard is shown on `/demo/[id]` with live metrics (scene count, planned
duration, estimated speaking time, target). The user can **edit narration**,
**reorder**, **remove**, and **regenerate** individual scenes, then click
**Approve Storyboard**. Any structural edit resets the plan to `draft`.
Recording is gated on approval: approving completes the `demo_planning`
pipeline stage; recording must not start until then.

Endpoints:

```
POST /api/demo/[id]/plan                              Generate the storyboard
PUT  /api/demo/[id]/plan                              Replace scenes (edit/reorder/remove)
POST /api/demo/[id]/plan/approve                      Approve (unlock recording)
POST /api/demo/[id]/plan/scene/[sceneId]/regenerate   Regenerate one scene
```

## Browser Action Engine (Phase 4)

Converts an **approved** storyboard into safe, structured browser actions that a
Playwright executor can later run. The system never generates arbitrary
JavaScript — the AI (and any client edit) may only produce actions from a fixed
allowlist.

Files (`src/lib/browser/`):

- `types.ts` — the `BrowserAction` discriminated union (navigate, click, fill,
  select, scroll, wait, hover, press, screenshot), plus `PlannedBrowserAction`,
  `SceneActionSet`, `ActionPlan`, and `ActionExecutionResult`.
- `schemas.ts` — strict Zod schemas for every action. Rejects arbitrary
  JavaScript, `eval`, `Function`, shell/`exec`/`spawn`, filesystem access,
  `fetch`/XHR, `require`/dynamic import, `<script>`/`<iframe>`, inline event
  handlers, and `javascript:`/`data:`/`file:`/`chrome:`/`about:` URLs. `.strict()`
  rejects unknown keys.
- `action-security.ts` — `checkNavigationTarget` (https-only, same-domain as the
  approved site, internal/loopback/metadata IPs blocked by reusing the
  explorer's SSRF blocklist) and `flagDestructiveAction` (marks
  delete/checkout/logout/payment/purchase/send/publish/change-password/etc as
  `requiresHumanApproval`).
- `action-planner.ts` — `generateActionPlan` maps each approved scene to
  allowlisted actions using robust selectors (data-testid → role/name → label →
  visible text → stable CSS; avoids nth-child, generated classes, deep chains).
  Every synthesized action is validated by the Zod schema. This module is
  deterministic and has no AI-provider imports (provider logic stays in the AI
  layer).
- `playwright-executor.ts` — `executeActions` runs actions in headless Chromium.
  It re-validates each action, blocks off-domain/internal navigation, refuses
  flagged actions unless explicitly allowed, and before every
  click/fill/select/hover checks the target exists and is visible with a bounded
  timeout. It returns an `ActionExecutionResult` for every action — errors are
  never swallowed.

The preview UI (`BrowserActionsPanel`) appears on `/demo/[id]` once the
storyboard is approved. It lists actions per scene (type, description, selector,
status), flags sensitive actions as "needs approval", and lets the user
regenerate, edit descriptions, delete, and reorder actions before clicking
**Approve Browser Actions**. Any edit resets the plan to draft.

Endpoints:

```
POST /api/demo/[id]/actions           Generate actions from the approved storyboard
PUT  /api/demo/[id]/actions           Replace a scene's actions (edit/delete/reorder)
POST /api/demo/[id]/actions/approve   Approve the action plan
GET  /api/dev/action-test             Dev-only: run navigate/click/scroll/screenshot on example.com
```

Recording is handled by Phase 5 (below); it is gated on this approval.

## Browser Recording (Phase 5)

Once browser actions are approved, AutoDemo launches Playwright, executes the
approved `BrowserAction[]` scene by scene, and produces a deterministic,
reproducible video recording. No voice/captions are added at this stage.

Files:

- `src/lib/video/recording-settings.ts` — configurable recording settings
  (viewport, defaulting to 1440x900, `deviceScaleFactor`, `fps`, `videoFormat`
  webm, `browser` chromium, `animationDelay`, `actionTimeout`). Overridable via
  `AUTODEMO_REC_*` env vars.
- `src/lib/browser/recorder.ts` — `recordDemo`: launches Chromium with a fixed
  viewport + scale factor and `reducedMotion` for determinism, records the whole
  session to WebM, executes each scene's actions (reusing the executor's
  validation + security), captures a start and end screenshot per scene, and
  returns a `RecordingResult`. Artifacts are written under
  `public/recordings/<jobId>/` (gitignored) so the video is served statically.
- Types `RecordingSceneResult` and `RecordingResult` (in `browser/types.ts`)
  capture per-scene timing/screenshots/success and the overall
  video path, duration, scenes, screenshots, and errors.

**Fail loudly.** If any action fails, the recorder stops, captures a failure
screenshot, records the failed action + message + scene + timestamp, and the job
becomes `RECORDING_FAILED` — it never pretends success.

**Determinism.** Fixed viewport, device scale factor, reduced motion, and a
fixed post-action settle delay make repeated runs of the same actions produce
the same visual result.

Job statuses (Phase 5): `DRAFT`, `EXPLORING`, `PLANNING`, `STORYBOARD_READY`,
`ACTIONS_READY`, `RECORDING`, `RECORDING_COMPLETE`, `RECORDING_FAILED`.

Endpoint:

```
POST /api/demo/[id]/record
  Guards: storyboard approved, actions approved, no duplicate active recording.
  Response: { success, status, videoPath, duration, scenes, errors }
```

The `RecordingPanel` on `/demo/[id]` shows a "Generate Browser Recording" button
(enabled once actions are approved), progress messages while recording, and an
embedded video player plus per-scene results when complete. Captions,
Remotion, and FFmpeg composition are later phases.

## Voice Narration (Phase 6)

Turns each approved storyboard scene's narration into an audio file — one MP3
per scene. Audio is NOT merged with the recording yet (a later phase).

Files (`src/lib/tts/`):

- `types.ts` — the `TtsProvider` interface (`generateSpeech({ text, language,
  voice }) -> { audioPath, duration }`), plus `SceneAudio` / `VoiceOver`
  metadata and `TtsError`.
- `voices.ts` — maps the app's language keys (English, Mandarin) and voice keys
  (Professional/Friendly × Female/Male) to provider voice ids. Provider-specific
  ids never reach the UI. Adding a language means extending these tables.
- `provider.ts` — `PollyTtsProvider` (Amazon Polly, lazy-loaded SDK) and an
  offline `MockTtsProvider` that writes a valid silent MP3. `getTtsProvider`
  picks Polly when AWS is configured (or `AUTODEMO_TTS_PROVIDER=polly`),
  otherwise the mock — so the app runs with zero cloud setup.
- `voice-generation.ts` — generates audio per scene with **partial-success**
  handling: if one scene fails, the others still succeed and the failed one is
  marked for retry.

Supported languages: **English** and **Mandarin Chinese** (structured so more
can be added). Voices: Professional Female/Male, Friendly Female/Male.

Per-scene audio is written to `public/voice/<jobId>/scene-001.mp3`, ... (served
statically, gitignored). Stored metadata per scene: `sceneId`, `order`,
`language`, `voice`, `text`, `duration`, `audioPath`, `status`.

Job statuses (Phase 6): `VOICE_GENERATING`, `VOICE_READY`, `VOICE_FAILED`.

Endpoints:

```
POST  /api/demo/[id]/voice   Generate narration audio for every scene
  Guards: storyboard approved, language supported (English/Mandarin), no
  duplicate active voice job.
PATCH /api/demo/[id]/voice   Regenerate one scene's audio ({ sceneId }),
  preserving all other scenes.
```

The `VoicePanel` on `/demo/[id]` shows a "Generate Voice" button (enabled once
the storyboard is approved and the language is supported), per-scene progress,
and an audio player per scene with a Regenerate/Retry control. Failed scenes are
shown with their error and a retry; successful scenes are preserved. Merging
audio with video, captions, and Remotion/FFmpeg are later phases.

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
- No text-to-speech or video generation.
- No autonomous browser interaction. The explorer is passive (read-only): it
  does not click, type, or submit. Feature Discovery only analyzes the captured
  snapshot.
- No mobile-optimized layouts (desktop-first for this milestone).
- No production database (in-memory store only).
