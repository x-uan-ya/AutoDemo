import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  safeSegment,
  resolveWithin,
  toPublicUrl,
  PathSecurityError,
  ARTIFACT_ROOT,
  PUBLIC_ROOT,
} from "../paths";

/**
 * Path-traversal security tests. All generated artifacts must stay under the
 * trusted artifact root; no request-derived value may escape it.
 */

// --- safeSegment rejection -------------------------------------------------

test("safeSegment rejects .. traversal", () => {
  assert.throws(() => safeSegment(".."), PathSecurityError);
});

test("safeSegment rejects . ", () => {
  assert.throws(() => safeSegment("."), PathSecurityError);
});

test("safeSegment rejects forward-slash traversal", () => {
  assert.throws(() => safeSegment("../secret.txt"), PathSecurityError);
});

test("safeSegment rejects backslash traversal", () => {
  assert.throws(() => safeSegment("..\\secret.txt"), PathSecurityError);
});

test("safeSegment rejects embedded separators", () => {
  assert.throws(() => safeSegment("a/b"), PathSecurityError);
  assert.throws(() => safeSegment("a\\b"), PathSecurityError);
});

test("safeSegment rejects null byte", () => {
  assert.throws(() => safeSegment("file\0.txt"), PathSecurityError);
});

test("safeSegment rejects drive letters", () => {
  assert.throws(() => safeSegment("C:"), PathSecurityError);
});

test("safeSegment rejects empty and over-long segments", () => {
  assert.throws(() => safeSegment(""), PathSecurityError);
  assert.throws(() => safeSegment("a".repeat(129)), PathSecurityError);
});

test("safeSegment accepts normal ids, language codes, filenames", () => {
  assert.equal(safeSegment("demo_abc123"), "demo_abc123");
  assert.equal(safeSegment("en-US"), "en-US");
  assert.equal(safeSegment("scene.01.mp4"), "scene.01.mp4");
});

// --- resolveWithin containment --------------------------------------------

test("resolveWithin keeps resolved path inside the base", () => {
  const resolved = resolveWithin(ARTIFACT_ROOT, "job123", "en-US");
  assert.ok(resolved.startsWith(ARTIFACT_ROOT + path.sep));
});

test("resolveWithin rejects traversal segments", () => {
  assert.throws(() => resolveWithin(ARTIFACT_ROOT, "..", "etc"), PathSecurityError);
  assert.throws(() => resolveWithin(ARTIFACT_ROOT, "../../etc/passwd"), PathSecurityError);
});

// --- toPublicUrl -----------------------------------------------------------

test("toPublicUrl maps an artifact path to a web path", () => {
  const abs = path.join(PUBLIC_ROOT, "_artifacts", "job1", "video.mp4");
  assert.equal(toPublicUrl(abs), "/_artifacts/job1/video.mp4");
});

test("toPublicUrl rejects a path outside public/", () => {
  const outside = path.join(process.cwd(), "..", "secret.txt");
  assert.throws(() => toPublicUrl(outside), PathSecurityError);
});
