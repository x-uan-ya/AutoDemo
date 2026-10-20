import path from "node:path";

/**
 * Path-traversal protection for server-generated artifacts.
 *
 * Users must never control arbitrary filesystem paths. All generated assets
 * (recordings, voice, renders) live under the app's public/ artifact root, and
 * every path segment that originates from a request value (job id, language
 * code, scene name) must pass safeSegment().
 */

/** Root under which all generated artifacts are written and served. */
export const PUBLIC_ROOT = path.join(process.cwd(), "public");
export const ARTIFACT_ROOT = path.join(PUBLIC_ROOT, "_artifacts");

export class PathSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSecurityError";
  }
}

/** Allowlist for a single path segment: letters, digits, dash, underscore, dot. */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Validate a single path segment (a id, language code, or file base name).
 * Rejects traversal (`..`), separators, drive letters, UNC, and anything not in
 * the conservative allowlist. Returns the segment unchanged on success.
 */
export function safeSegment(segment: string): string {
  if (typeof segment !== "string" || segment.length === 0 || segment.length > 128) {
    throw new PathSecurityError("Invalid path segment.");
  }
  if (segment === "." || segment === "..") {
    throw new PathSecurityError("Path traversal is not allowed.");
  }
  if (segment.includes("/") || segment.includes("\\") || segment.includes("\0")) {
    throw new PathSecurityError("Path separators are not allowed in a segment.");
  }
  if (/^[A-Za-z]:/.test(segment)) {
    throw new PathSecurityError("Drive letters are not allowed.");
  }
  if (!SAFE_SEGMENT.test(segment)) {
    throw new PathSecurityError("Segment contains disallowed characters.");
  }
  return segment;
}

/**
 * Resolve a directory under a trusted base from untrusted segments, asserting
 * the final resolved path stays within the base (defense in depth beyond
 * safeSegment). Returns the absolute directory path.
 */
export function resolveWithin(base: string, ...segments: string[]): string {
  const safe = segments.map(safeSegment);
  const resolved = path.resolve(base, ...safe);
  const baseResolved = path.resolve(base);
  // Must be the base itself or strictly inside it.
  if (resolved !== baseResolved && !resolved.startsWith(baseResolved + path.sep)) {
    throw new PathSecurityError("Resolved path escapes the artifact root.");
  }
  return resolved;
}

/** Convert an absolute path under public/ to the public URL path that serves it. */
export function toPublicUrl(absPath: string): string {
  const rel = path.relative(PUBLIC_ROOT, path.resolve(absPath));
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new PathSecurityError("Path is not under the public root.");
  }
  return "/" + rel.split(path.sep).join("/");
}
