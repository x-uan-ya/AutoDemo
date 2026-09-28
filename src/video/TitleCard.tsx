import { useCurrentFrame, useVideoConfig, interpolate, spring } from "remotion";
import type { TitleCardData } from "./types";

/** Opening title card: demo title, website name, optional subtitle. */
export function TitleCard({ data }: { data: TitleCardData }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Gentle rise-in for the title.
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const translateY = interpolate(enter, [0, 1], [24, 0]);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #1e1b4b 0%, #4338ca 100%)",
        color: "white",
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif",
        transform: `translateY(${translateY}px)`,
        opacity: enter,
      }}
    >
      <div
        style={{
          fontSize: 28,
          letterSpacing: 4,
          textTransform: "uppercase",
          opacity: 0.7,
          marginBottom: 24,
        }}
      >
        AutoDemo
      </div>
      <div
        style={{
          fontSize: 72,
          fontWeight: 700,
          textAlign: "center",
          padding: "0 10%",
          lineHeight: 1.1,
        }}
      >
        {data.title}
      </div>
      <div style={{ fontSize: 40, marginTop: 28, opacity: 0.92 }}>
        {data.website}
      </div>
      {data.subtitle && (
        <div style={{ fontSize: 26, marginTop: 16, opacity: 0.6 }}>
          {data.subtitle}
        </div>
      )}
    </div>
  );
}
