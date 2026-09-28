import type { EndCardData } from "./types";

/** Closing end card. Simple and calm — no flashy effects. */
export function EndCard({ data }: { data: EndCardData }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)",
        color: "white",
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif",
      }}
    >
      <div style={{ fontSize: 56, fontWeight: 700 }}>{data.text}</div>
      <div style={{ fontSize: 26, marginTop: 20, opacity: 0.6 }}>AutoDemo</div>
    </div>
  );
}
