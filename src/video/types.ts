/**
 * Phase 7 — Video rendering types.
 *
 * These describe the input props passed into the Remotion composition and the
 * timeline the renderer walks. Everything here is plain data (serializable) so
 * the composition is deterministic: given the same props, the same MP4 comes
 * out.
 */

/** Output video configuration. Defaults to 1080p / 30fps (configurable later). */
export interface VideoConfig {
  width: number;
  height: number;
  fps: number;
}

export const DEFAULT_VIDEO_CONFIG: VideoConfig = {
  width: 1920,
  height: 1080,
  fps: 30,
};

/** A single timed caption line. */
export interface Caption {
  text: string;
  /** Start time in seconds, relative to the scene start. */
  start: number;
  /** End time in seconds, relative to the scene start. */
  end: number;
}

/**
 * A cursor keyframe. Only used when real action coordinates are available; we
 * never invent coordinates (the current action model has none, so cursor is
 * off by default).
 */
export interface CursorKeyframe {
  /** Time in seconds relative to scene start. */
  t: number;
  /** X/Y as a fraction of the frame (0..1), resolution-independent. */
  x: number;
  y: number;
  /** Whether a click pulse should play at this keyframe. */
  click?: boolean;
}

/** One scene on the video timeline. */
export interface TimelineScene {
  sceneId: string;
  order: number;
  title: string;
  narration: string;
  /** Public path to the scene's narration audio, or null if none. */
  audioPath: string | null;
  /** Public path to the still image shown for the scene (recording frame). */
  imagePath: string | null;
  /** Scene duration in seconds (driven by the audio, not a fixed value). */
  durationInSeconds: number;
  captions: Caption[];
  /** Cursor keyframes; empty when no coordinates are available. */
  cursor: CursorKeyframe[];
}

/** Opening title card content. */
export interface TitleCardData {
  title: string;
  website: string;
  subtitle?: string;
  /** Seconds the title card is shown. */
  durationInSeconds: number;
}

/** Closing end card content. */
export interface EndCardData {
  text: string;
  durationInSeconds: number;
}

/**
 * The full set of props the Remotion composition renders from. This is the
 * single source of truth for the video's timeline and appearance.
 */
export interface AutoDemoVideoProps {
  config: VideoConfig;
  titleCard: TitleCardData | null;
  scenes: TimelineScene[];
  endCard: EndCardData | null;
  /** Master switch for the cursor overlay. */
  showCursor: boolean;
  /** Crossfade duration between segments, in seconds. */
  transitionSeconds: number;
  /**
   * Index signature so these props satisfy Remotion's
   * `Record<string, unknown>` constraint for composition props.
   */
  [key: string]: unknown;
}

/** The composition id registered in the Remotion Root. */
export const AUTODEMO_COMPOSITION_ID = "AutoDemoVideo";

// ---------------------------------------------------------------------------
// Persisted render metadata (stored on the DemoJob)
// ---------------------------------------------------------------------------

export type RenderStatusValue = "rendering" | "render_complete" | "render_failed";

export interface RenderResult {
  status: RenderStatusValue;
  /** Public path to the rendered MP4, or null on failure. */
  videoPath: string | null;
  /** Total video duration in seconds. */
  duration: number;
  config: VideoConfig;
  /** Number of scenes included in the render. */
  sceneCount: number;
  error?: string;
  renderedAt: string;
}
