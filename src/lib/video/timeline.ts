import type { DemoJob } from "@/types";
import type {
  AutoDemoVideoProps,
  Caption,
  TimelineScene,
} from "@/video/types";
import { DEFAULT_VIDEO_CONFIG } from "@/video/types";
import { labelFor, PURPOSE_OPTIONS } from "@/lib/options";

/**
 * Phase 7 timeline builder (pure, deterministic).
 *
 * Assembles the Remotion composition props from a job's storyboard, recording,
 * and voice-over:
 *   - one timeline scene per storyboard scene, in order;
 *   - each scene's duration is driven by its narration AUDIO duration (never a
 *     fixed value); when audio is missing we fall back to a reading-time
 *     estimate so the scene is never zero-length;
 *   - captions are generated from the narration, timed across the scene;
 *   - a title card and end card bracket the scenes.
 *
 * No cursor coordinates exist in the action model, so cursor keyframes are
 * always empty here — we never invent coordinates.
 */

const TITLE_CARD_SECONDS = 3;
const END_CARD_SECONDS = 2.5;
const TRANSITION_SECONDS = 0.5;
/** Minimum seconds per scene so nothing flashes by. */
const MIN_SCENE_SECONDS = 2.5;
/** Words/sec used only to estimate duration when audio is unavailable. */
const WORDS_PER_SECOND = 2.5;
/** Max characters per caption line before splitting into another cue. */
const MAX_CAPTION_CHARS = 90;

function estimateReadingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(MIN_SCENE_SECONDS, words / WORDS_PER_SECOND);
}

/**
 * Split narration into caption cues and distribute them evenly across the
 * scene duration. Sentence-aware, with a character cap so lines stay readable.
 */
export function buildCaptions(
  narration: string,
  sceneDuration: number
): Caption[] {
  const text = narration.trim();
  if (!text) return [];

  // Split on sentence boundaries (keep CJK-friendly by also splitting on 。！？).
  const rawParts = text
    .split(/(?<=[.!?。！？])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Further split overly long sentences on a length budget.
  const cues: string[] = [];
  for (const part of rawParts) {
    if (part.length <= MAX_CAPTION_CHARS) {
      cues.push(part);
      continue;
    }
    let remaining = part;
    while (remaining.length > MAX_CAPTION_CHARS) {
      // Break at the last space within the budget, else hard-break.
      const slice = remaining.slice(0, MAX_CAPTION_CHARS);
      const br = slice.lastIndexOf(" ");
      const cut = br > 40 ? br : MAX_CAPTION_CHARS;
      cues.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    }
    if (remaining) cues.push(remaining);
  }

  if (cues.length === 0) return [];

  // Weight each cue's on-screen time by its length so longer lines linger.
  const totalChars = cues.reduce((sum, c) => sum + c.length, 0) || 1;
  let cursor = 0;
  const captions: Caption[] = [];
  for (const cue of cues) {
    const share = (cue.length / totalChars) * sceneDuration;
    const start = cursor;
    const end = Math.min(sceneDuration, cursor + share);
    captions.push({ text: cue, start, end });
    cursor = end;
  }
  // Ensure the last caption reaches the scene end.
  if (captions.length > 0) captions[captions.length - 1].end = sceneDuration;
  return captions;
}

/** Find the best still image for a scene from its recording result. */
function sceneImage(job: DemoJob, sceneId: string): string | null {
  const rec = job.recording;
  if (!rec) return null;
  const sceneRec = rec.scenes.find((s) => s.sceneId === sceneId);
  if (!sceneRec || sceneRec.screenshotPaths.length === 0) return null;
  // Prefer the scene's END screenshot (the settled state); fall back to start.
  const end = sceneRec.screenshotPaths.find((p) => p.includes("-end"));
  return end ?? sceneRec.screenshotPaths[sceneRec.screenshotPaths.length - 1];
}

export interface BuildTimelineOptions {
  showCursor?: boolean;
  includeTitleCard?: boolean;
  includeEndCard?: boolean;
}

/**
 * Build the full composition props for a job. Assumes the caller has validated
 * that a storyboard exists; scenes with neither audio nor narration are still
 * included with an estimated duration so ordering is preserved.
 */
export function buildTimeline(
  job: DemoJob,
  options: BuildTimelineOptions = {}
): AutoDemoVideoProps {
  const {
    showCursor = false,
    includeTitleCard = true,
    includeEndCard = true,
  } = options;

  const planScenes = [...(job.plan?.scenes ?? [])].sort(
    (a, b) => a.order - b.order
  );

  const scenes: TimelineScene[] = planScenes.map((scene) => {
    const audio = job.voiceOver?.scenes.find((a) => a.sceneId === scene.id);
    const audioPath =
      audio && audio.status === "ready" ? audio.audioPath : null;

    // Duration is driven by the audio; fall back to reading time when absent.
    const durationInSeconds =
      audioPath && audio && audio.duration > 0
        ? Math.max(MIN_SCENE_SECONDS, audio.duration)
        : estimateReadingSeconds(scene.narration);

    return {
      sceneId: scene.id,
      order: scene.order,
      title: scene.title,
      narration: scene.narration,
      audioPath,
      imagePath: sceneImage(job, scene.id),
      durationInSeconds,
      captions: buildCaptions(scene.narration, durationInSeconds),
      // No coordinates in the action model -> never invent cursor motion.
      cursor: [],
    };
  });

  return {
    config: DEFAULT_VIDEO_CONFIG,
    titleCard: includeTitleCard
      ? {
          title: `${job.title} — ${labelFor(PURPOSE_OPTIONS, job.settings.purpose)}`,
          website: hostOf(job.settings.websiteUrl),
          subtitle: "Generated by AutoDemo",
          durationInSeconds: TITLE_CARD_SECONDS,
        }
      : null,
    scenes,
    endCard: includeEndCard
      ? { text: "Thanks for watching", durationInSeconds: END_CARD_SECONDS }
      : null,
    showCursor,
    transitionSeconds: TRANSITION_SECONDS,
  };
}

/** Total composition duration in frames, for the Remotion <Composition>. */
export function totalDurationInFrames(
  props: AutoDemoVideoProps
): number {
  const secs =
    (props.titleCard?.durationInSeconds ?? 0) +
    props.scenes.reduce((sum, s) => sum + s.durationInSeconds, 0) +
    (props.endCard?.durationInSeconds ?? 0);
  // At least 1 frame; round up so no content is cut.
  return Math.max(1, Math.ceil(secs * props.config.fps));
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
