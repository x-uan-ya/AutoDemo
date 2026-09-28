/** Minimal typing for the Remotion webpack override module. */
declare module "*/webpack-override.mjs" {
  // Remotion's WebpackOverrideFn: (config) => config. Kept loose on purpose.
  export function webpackOverride(config: unknown): unknown;
}
