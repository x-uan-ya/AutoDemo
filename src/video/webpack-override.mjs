import path from "node:path";

/**
 * Webpack override for the Remotion bundle.
 *
 * The video components use the app's "@/..." path alias (e.g. "@/types"),
 * which Remotion's default webpack config does not know about. This adds the
 * same alias Next uses (src/*) plus the ".ts/.tsx" resolve extensions so the
 * composition bundles correctly during rendering.
 */
export function webpackOverride(config) {
  return {
    ...config,
    resolve: {
      ...(config.resolve ?? {}),
      alias: {
        ...(config.resolve?.alias ?? {}),
        "@": path.join(process.cwd(), "src"),
      },
      extensions: [
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ...((config.resolve && config.resolve.extensions) || []),
      ],
    },
  };
}
