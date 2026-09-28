import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

/**
 * A restrained fade transition wrapper. Fades content in at the start and out
 * at the end of its containing sequence over `fadeSeconds`. Deliberately subtle
 * — no flashy effects.
 */
export function FadeTransition({
  fadeSeconds,
  durationInFrames,
  children,
}: {
  fadeSeconds: number;
  durationInFrames: number;
  children: React.ReactNode;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeFrames = Math.max(1, Math.round(fadeSeconds * fps));

  const opacity = interpolate(
    frame,
    [0, fadeFrames, durationInFrames - fadeFrames, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return <div style={{ opacity, width: "100%", height: "100%" }}>{children}</div>;
}
