import { promises as fs } from "node:fs";
import path from "node:path";
import type { DemoJob } from "@/types";
import type { AutoDemoVideoProps, RenderResult } from "@/video/types";
import { AUTODEMO_COMPOSITION_ID } from "@/video/types";
import { buildTimeline, totalDurationInFrames } from "./timeline";

/**
 * Phase 7 render service.
 *
 * Bundles the Remotion project, selects the AutoDemo composition with the job's
 * timeline as input props, and renders an MP4 under public/renders/<jobId>/.
 * Deterministic: the same job data yields the same video.
 *
 * The Remotion SDK (@remotion/bundler, @remotion/renderer) is imported lazily
 * so it only loads when a render actually runs (it is heavy and Node-only).
 */

const RENDER_ROOT = path.join(process.cwd(), "public", "renders");
const PUBLIC_DIR = path.join(process.cwd(), "public");
const ENTRY = path.join(process.cwd(), "src", "video", "index.ts");

function publicPath(absPath: string): string {
  const rel = path.relative(PUBLIC_DIR, absPath);
  return "/" + rel.split(path.sep).join("/");
}

export class RenderError extends Error {
  code: "config" | "bundle" | "render";
  constructor(code: RenderError["code"], message: string) {
    super(message);
    this.name = "RenderError";
    this.code = code;
  }
}

export interface RenderOptions {
  onProgress?: (stage: string, progress: number) => void;
}

export async function renderDemoVideo(
  job: DemoJob,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const progress = options.onProgress ?? (() => {});

  // Build the timeline props from the job's storyboard/recording/voice.
  const props: AutoDemoVideoProps = buildTimeline(job, {
    showCursor: false,
    includeTitleCard: true,
    includeEndCard: true,
  });

  if (props.scenes.length === 0) {
    throw new RenderError("config", "There are no scenes to render.");
  }

  const outDir = path.join(RENDER_ROOT, job.id);
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "demo.mp4");

  // Lazy-load the heavy Remotion Node APIs.
  const { bundle } = await import("@remotion/bundler");
  const { selectComposition, renderMedia } = await import(
    "@remotion/renderer"
  );

  progress("bundling", 0);
  // Load the webpack override that teaches Remotion the "@/..." path alias.
  const { webpackOverride } = await import(
    "../../video/webpack-override.mjs"
  );
  let serveUrl: string;
  try {
    serveUrl = await bundle({
      entryPoint: ENTRY,
      // Serve the app's public dir so staticFile() resolves voice/recording
      // artifacts during rendering.
      publicDir: PUBLIC_DIR,
      webpackOverride,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RenderError("bundle", `Bundling failed: ${message}`);
  }

  progress("preparing", 0.15);
  let composition;
  try {
    composition = await selectComposition({
      serveUrl,
      id: AUTODEMO_COMPOSITION_ID,
      inputProps: props,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RenderError("render", `Composition selection failed: ${message}`);
  }

  progress("rendering", 0.2);
  try {
    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      outputLocation: outFile,
      inputProps: props,
      // Deterministic single-thread-ish defaults; Remotion bundles ffmpeg.
      onProgress: ({ progress: p }) => progress("rendering", 0.2 + p * 0.8),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new RenderError("render", `Rendering failed: ${message}`);
  }

  // Video duration is the timeline length (audio-driven), not wall-clock.
  const durationSeconds = totalDurationInFrames(props) / props.config.fps;

  progress("done", 1);
  return {
    status: "render_complete",
    videoPath: publicPath(outFile),
    duration: durationSeconds,
    config: props.config,
    sceneCount: props.scenes.length,
    renderedAt: new Date().toISOString(),
  };
}
