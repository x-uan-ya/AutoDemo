/**
 * Ambient declaration for the OPTIONAL `ioredis` dependency.
 *
 * `ioredis` is only required in deployments that configure Redis
 * (`REDIS_URL`). It is intentionally NOT a build-time dependency, so this
 * minimal declaration lets the code type-check and compile without the package
 * installed. The runtime import is lazy and guarded (see src/lib/redis/client.ts);
 * if Redis is configured but the package is missing, a clear error is thrown.
 *
 * When `ioredis` IS installed, its own bundled types take precedence over this
 * fallback.
 */
declare module "ioredis" {
  // Minimal surface; the real types are used when the package is installed.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const IoRedis: any;
  export default IoRedis;
}
