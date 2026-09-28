import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import type { CursorKeyframe } from "./types";

/**
 * Simple animated cursor overlay.
 *
 * It moves between keyframes whose x/y are fractions of the frame (0..1). It is
 * ONLY rendered when real keyframes are provided — we never invent coordinates.
 * With the current action model (selector-based, no coordinates) there are no
 * keyframes, so this renders nothing; it exists for when coordinate data is
 * available.
 */
export function Cursor({ keyframes }: { keyframes: CursorKeyframe[] }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;

  if (keyframes.length === 0) return null;

  // Find the surrounding keyframes and interpolate position.
  const times = keyframes.map((k) => k.t);
  const xs = keyframes.map((k) => k.x * width);
  const ys = keyframes.map((k) => k.y * height);

  const x = interpolate(t, times, xs, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const y = interpolate(t, times, ys, {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Click pulse when close to a click keyframe.
  const nearClick = keyframes.some((k) => k.click && Math.abs(k.t - t) < 0.15);

  return (
    <div style={{ position: "absolute", left: 0, top: 0 }}>
      {nearClick && (
        <div
          style={{
            position: "absolute",
            left: x - 24,
            top: y - 24,
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: "3px solid rgba(99,102,241,0.9)",
            opacity: 0.7,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: 22,
          height: 22,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.95)",
          border: "2px solid rgba(15,23,42,0.85)",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
          transform: "translate(-2px, -2px)",
        }}
      />
    </div>
  );
}
