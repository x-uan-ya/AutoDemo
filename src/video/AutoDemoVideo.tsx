import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { AutoDemoVideoProps } from "./types";
import { Scene } from "./Scene";
import { TitleCard } from "./TitleCard";
import { EndCard } from "./EndCard";
import { FadeTransition } from "./Transition";

/**
 * Root composition. Lays out the timeline as back-to-back sequences:
 *   [title card] -> [scene 1] -> [scene 2] -> ... -> [end card]
 *
 * Each segment is wrapped in a subtle fade so scenes don't cut hard. Segment
 * lengths come from the props (scene lengths are audio-driven), so ordering and
 * timing are exact and deterministic.
 */
export function AutoDemoVideo(props: AutoDemoVideoProps) {
  const { fps } = useVideoConfig();
  const toFrames = (secs: number) => Math.max(1, Math.round(secs * fps));

  const segments: { key: string; frames: number; node: React.ReactNode }[] = [];

  if (props.titleCard) {
    const frames = toFrames(props.titleCard.durationInSeconds);
    segments.push({
      key: "title",
      frames,
      node: <TitleCard data={props.titleCard} />,
    });
  }

  for (const scene of props.scenes) {
    const frames = toFrames(scene.durationInSeconds);
    segments.push({
      key: scene.sceneId,
      frames,
      node: <Scene scene={scene} showCursor={props.showCursor} />,
    });
  }

  if (props.endCard) {
    const frames = toFrames(props.endCard.durationInSeconds);
    segments.push({
      key: "end",
      frames,
      node: <EndCard data={props.endCard} />,
    });
  }

  let cursor = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b1220" }}>
      {segments.map((seg) => {
        const from = cursor;
        cursor += seg.frames;
        return (
          <Sequence
            key={seg.key}
            from={from}
            durationInFrames={seg.frames}
            name={seg.key}
          >
            <FadeTransition
              fadeSeconds={props.transitionSeconds}
              durationInFrames={seg.frames}
            >
              {seg.node}
            </FadeTransition>
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
