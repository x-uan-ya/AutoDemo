import { promises as fs } from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import {
  executeSingleAction,
  applyNetworkGuard,
} from "./playwright-executor";
import { summarize } from "./action-planner";
import type {
  RecordingResult,
  RecordingSceneResult,
  RecordingActionFailure,
  SceneActionSet,
} from "./types";
import {
  resolveRecordingSettings,
  type RecordingSettings,
} from "@/lib/video/recording-settings";

/**
 * Phase 5 deterministic browser recorder.
 *
 * Launches Chromium with a fixed viewport / device scale factor, records the
 * whole session to a video, and executes the approved action sets scene by
 * scene. For each scene it captures a start and end screenshot and records
 * timing + success. Errors are never swallowed: a failed action stops the run
 * and the result is marked unsuccessful with full failure context.
 *
 * Determinism: consistent viewport, scale factor, disabled animations where
 * possible, and a fixed post-action delay make repeated runs of the same
 * actions produce the same visual result.
 *
 * SECURITY: reuses the executor's per-action validation, destructive-action
 * refusal, navigation scoping, and the http/https network guard.
 */

/** Root directory (under /public) where recording artifacts are written. */
const ARTIFACT_ROOT = path.join(process.cwd(), "public", "recordings");

export interface RecordOptions {
  jobId: string;
  websiteUrl: string;
  scenes: SceneActionSet[];
  settings?: Partial<RecordingSettings>;
  /** Progress callback for streaming UI updates (optional). */
  onProgress?: (message: string) => void;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Public URL path for an artifact written under /public. */
function publicPath(absPath: string): string {
  const rel = path.relative(path.join(process.cwd(), "public"), absPath);
  return "/" + rel.split(path.sep).join("/");
}

export async function recordDemo(
  options: RecordOptions
): Promise<RecordingResult> {
  const settings = resolveRecordingSettings(options.settings);
  const progress = options.onProgress ?? (() => {});

  const runDir = path.join(ARTIFACT_ROOT, options.jobId);
  const screenshotDir = path.join(runDir, "screenshots");
  const videoDir = path.join(runDir, "video");
  await fs.mkdir(screenshotDir, { recursive: true });
  await fs.mkdir(videoDir, { recursive: true });

  const sceneResults: RecordingSceneResult[] = [];
  const allScreenshots: string[] = [];
  const errors: RecordingActionFailure[] = [];
  const startedAt = Date.now();

  let browser: Browser | null = null;
  let videoPublicPath: string | null = null;
  let overallSuccess = true;

  progress("Preparing browser...");

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      viewport: {
        width: settings.viewportWidth,
        height: settings.viewportHeight,
      },
      deviceScaleFactor: settings.deviceScaleFactor,
      javaScriptEnabled: true,
      // Reduce motion for more deterministic frames.
      reducedMotion: "reduce",
      userAgent:
        "Mozilla/5.0 (compatible; AutoDemoRecorder/1.0; +https://autodemo.example/bot)",
      recordVideo: {
        dir: videoDir,
        size: {
          width: settings.viewportWidth,
          height: settings.viewportHeight,
        },
      },
    });
    context.setDefaultTimeout(settings.actionTimeout);
    context.setDefaultNavigationTimeout(30_000);

    // SECURITY: same http/https-only network guard as the executor.
    await applyNetworkGuard(context);

    const page = await context.newPage();

    // Execute scene by scene.
    sceneLoop: for (const scene of options.scenes) {
      progress(`Recording scene ${scene.order}: ${scene.title}...`);

      const sceneStart = nowIso();
      const screenshotPaths: string[] = [];
      let sceneOk = true;
      let sceneError: string | undefined;

      // Scene start screenshot (skipped cleanly if the page has no content
      // yet, e.g. before the first navigate).
      const startShot = await safeScreenshot(
        page,
        screenshotDir,
        `scene-${scene.order}-start`
      );
      if (startShot) {
        screenshotPaths.push(publicPath(startShot));
        allScreenshots.push(publicPath(startShot));
      }

      for (const planned of scene.actions) {
        const result = await executeSingleAction(page, planned.action, {
          websiteUrl: options.websiteUrl,
          actionTimeoutMs: settings.actionTimeout,
          // Recording never auto-runs destructive actions.
          allowFlaggedActions: false,
          screenshotDir,
        });

        if (!result.success) {
          // FAIL LOUDLY: capture context and stop the run.
          sceneOk = false;
          overallSuccess = false;
          const failShot = await safeScreenshot(
            page,
            screenshotDir,
            `scene-${scene.order}-failure`
          );
          if (failShot) screenshotPaths.push(publicPath(failShot));

          sceneError = result.message ?? "Action failed.";
          errors.push({
            sceneId: scene.sceneId,
            action: summarize(planned.action),
            message: sceneError,
            screenshotPath: failShot ? publicPath(failShot) : undefined,
            timestamp: nowIso(),
          });

          sceneResults.push({
            sceneId: scene.sceneId,
            title: scene.title,
            order: scene.order,
            startTime: sceneStart,
            endTime: nowIso(),
            screenshotPaths,
            success: false,
            error: sceneError,
          });
          // Stop the whole recording rather than pretend later scenes ran.
          break sceneLoop;
        }

        // Post-action settle delay for visible, deterministic frames.
        if (settings.animationDelay > 0) {
          await page.waitForTimeout(settings.animationDelay);
        }
      }

      if (sceneOk) {
        const endShot = await safeScreenshot(
          page,
          screenshotDir,
          `scene-${scene.order}-end`
        );
        if (endShot) {
          screenshotPaths.push(publicPath(endShot));
          allScreenshots.push(publicPath(endShot));
        }
        sceneResults.push({
          sceneId: scene.sceneId,
          title: scene.title,
          order: scene.order,
          startTime: sceneStart,
          endTime: nowIso(),
          screenshotPaths,
          success: true,
        });
      }
    }

    progress("Finalizing recording...");

    // The video is only written after the context (and its page) close.
    const pageVideo = page.video();
    await context.close();

    if (pageVideo) {
      try {
        const rawVideoPath = await pageVideo.path();
        // Move to a stable, predictable filename.
        const finalVideo = path.join(videoDir, "recording.webm");
        if (rawVideoPath !== finalVideo) {
          await fs.rename(rawVideoPath, finalVideo).catch(async () => {
            // rename can fail across devices; fall back to copy.
            await fs.copyFile(rawVideoPath, finalVideo);
          });
        }
        videoPublicPath = publicPath(finalVideo);
      } catch {
        // If we cannot resolve the video path, the run is not a success.
        overallSuccess = false;
      }
    } else {
      overallSuccess = false;
    }
  } catch (err) {
    overallSuccess = false;
    const message = err instanceof Error ? err.message : String(err);
    errors.push({
      sceneId: "-",
      action: "recorder setup",
      message: `Recorder error: ${message}`,
      timestamp: nowIso(),
    });
  } finally {
    if (browser) await browser.close().catch(() => undefined);
  }

  return {
    success: overallSuccess && errors.length === 0,
    videoPath: videoPublicPath,
    duration: Date.now() - startedAt,
    scenes: sceneResults,
    screenshots: allScreenshots,
    errors,
    recordedAt: nowIso(),
    viewport: {
      width: settings.viewportWidth,
      height: settings.viewportHeight,
    },
  };
}

/**
 * Take a screenshot, returning its absolute path, or null if it could not be
 * captured (e.g. blank page before first navigation). Never throws.
 */
async function safeScreenshot(
  page: Page,
  dir: string,
  name: string
): Promise<string | null> {
  const abs = path.join(dir, `${name}.png`);
  try {
    await page.screenshot({ path: abs, fullPage: false });
    return abs;
  } catch {
    return null;
  }
}
