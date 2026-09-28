import { useCurrentFrame, useVideoConfig } from "remotion";
import type { Caption as CaptionData } from "./types";

/**
 * Renders the active caption for the current frame at the bottom of the frame.
 * Captions are timed relative to the scene start (seconds), so we convert the
 * current frame to scene-relative seconds and pick the active cue.
 */
export function Caption({ captions }: { captions: CaptionData[] }) {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();
  const t = frame / fps;

  const active = captions.find((c) => t >= c.start && t < c.end);
  if (!active) return null;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 64,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        padding: "0 8%",
      }}
    >
      <div
        style={{
          maxWidth: width * 0.8,
          background: "rgba(15, 23, 42, 0.82)",
          color: "white",
          padding: "16px 28px",
          borderRadius: 14,
          fontSize: 34,
          lineHeight: 1.35,
          fontWeight: 500,
          textAlign: "center",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif",
          boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        }}
      >
        {active.text}
      </div>
    </div>
  );
}
