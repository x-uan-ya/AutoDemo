import { AbsoluteFill, Audio, Img, staticFile } from "remotion";
import type { TimelineScene } from "./types";
import { Caption } from "./Caption";
import { Cursor } from "./Cursor";

/**
 * A single scene: the recording still as the backdrop, the narration audio, a
 * small title chip, timed captions, and (only if coordinates exist) a cursor.
 *
 * Public asset paths (e.g. /voice/.../scene-001.mp3) are resolved with
 * staticFile so they load from Remotion's public dir during rendering.
 */
export function Scene({
  scene,
  showCursor,
}: {
  scene: TimelineScene;
  showCursor: boolean;
}) {
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b1220" }}>
      {/* Visual: the recording frame for this scene, letterboxed to fit. */}
      {scene.imagePath ? (
        <AbsoluteFill
          style={{ alignItems: "center", justifyContent: "center" }}
        >
          <Img
            src={toStatic(scene.imagePath)}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
            }}
          />
        </AbsoluteFill>
      ) : (
        <PlaceholderVisual title={scene.title} />
      )}

      {/* Narration audio; drives perceived scene timing. */}
      {scene.audioPath && <Audio src={toStatic(scene.audioPath)} />}

      {/* Scene title chip, top-left. */}
      <div
        style={{
          position: "absolute",
          top: 40,
          left: 48,
          background: "rgba(15,23,42,0.7)",
          color: "white",
          padding: "10px 18px",
          borderRadius: 999,
          fontSize: 26,
          fontWeight: 600,
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif",
        }}
      >
        {scene.order}. {scene.title}
      </div>

      {showCursor && <Cursor keyframes={scene.cursor} />}
      <Caption captions={scene.captions} />
    </AbsoluteFill>
  );
}

/** Shown when a scene has no recording still (keeps frames non-black). */
function PlaceholderVisual({ title }: { title: string }) {
  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #111827 0%, #1e293b 100%)",
        color: "white",
        fontSize: 48,
        fontWeight: 700,
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
        padding: "0 12%",
        textAlign: "center",
      }}
    >
      {title}
    </AbsoluteFill>
  );
}

/**
 * Convert a public URL path ("/voice/x.mp3") to a Remotion staticFile ref.
 * Absolute http(s) URLs are passed through unchanged.
 */
function toStatic(p: string): string {
  if (/^https?:\/\//.test(p)) return p;
  return staticFile(p.replace(/^\//, ""));
}
