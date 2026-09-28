/**
 * Recording settings for the Phase 5 deterministic browser recorder.
 *
 * These control the browser environment used while capturing a demo. They are
 * intentionally fixed/consistent so that recording the same action sequence
 * twice produces the same visual result (determinism). Everything here is
 * configurable via `resolveRecordingSettings` (env or explicit overrides).
 */

export type VideoFormat = "webm";
export type SupportedBrowser = "chromium";

export interface RecordingSettings {
  /** Viewport width in CSS pixels. */
  viewportWidth: number;
  /** Viewport height in CSS pixels. */
  viewportHeight: number;
  /** Frames per second hint for the recording. */
  fps: number;
  /** Output container format. Playwright records WebM. */
  videoFormat: VideoFormat;
  /** Which browser engine to use. */
  browser: SupportedBrowser;
  /**
   * Delay (ms) added after each action so on-screen changes are visible in the
   * video rather than flashing by. Also aids determinism by letting the page
   * settle before the next step.
   */
  animationDelay: number;
  /** Per-action timeout (ms) passed to the executor. */
  actionTimeout: number;
  /** Device scale factor (retina-like crispness). */
  deviceScaleFactor: number;
}

/**
 * Sensible demo defaults. 1440x900 is a common laptop viewport and reads well
 * in an embedded player.
 */
export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  viewportWidth: 1440,
  viewportHeight: 900,
  fps: 30,
  videoFormat: "webm",
  browser: "chromium",
  animationDelay: 700,
  actionTimeout: 10_000,
  deviceScaleFactor: 1,
};

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Resolve the effective settings: defaults, overlaid with any env overrides,
 * overlaid with explicit per-call overrides. Keeps the recorder configurable
 * without hard-coding values at the call site.
 */
export function resolveRecordingSettings(
  overrides: Partial<RecordingSettings> = {}
): RecordingSettings {
  const fromEnv: Partial<RecordingSettings> = {
    viewportWidth: intFromEnv(
      "AUTODEMO_REC_WIDTH",
      DEFAULT_RECORDING_SETTINGS.viewportWidth
    ),
    viewportHeight: intFromEnv(
      "AUTODEMO_REC_HEIGHT",
      DEFAULT_RECORDING_SETTINGS.viewportHeight
    ),
    fps: intFromEnv("AUTODEMO_REC_FPS", DEFAULT_RECORDING_SETTINGS.fps),
    animationDelay: intFromEnv(
      "AUTODEMO_REC_ANIMATION_DELAY",
      DEFAULT_RECORDING_SETTINGS.animationDelay
    ),
    actionTimeout: intFromEnv(
      "AUTODEMO_REC_ACTION_TIMEOUT",
      DEFAULT_RECORDING_SETTINGS.actionTimeout
    ),
  };

  return { ...DEFAULT_RECORDING_SETTINGS, ...fromEnv, ...overrides };
}
