import { test } from "node:test";
import assert from "node:assert/strict";
import { makeUserStore } from "./helpers";
import { getSessionStore } from "../session-store";

/**
 * Session + user store behavior:
 *   F. logout invalidates the session
 *   G. invalid / expired sessions are rejected
 *   + session fixation: rotate changes the id and kills the old one
 *   + credential verification + user enumeration resistance
 */

test("user store: register then verify credentials", async () => {
  const users = makeUserStore();
  await users.create("Alice@Example.com", "password-123");

  // Email is normalized (case-insensitive).
  const ok = await users.verifyCredentials("alice@example.com", "password-123");
  assert.ok(ok);
  assert.equal(ok?.email, "alice@example.com");
});

test("user store: wrong password returns null", async () => {
  const users = makeUserStore();
  await users.create("bob@example.com", "password-123");
  assert.equal(await users.verifyCredentials("bob@example.com", "nope"), null);
});

test("user store: unknown email returns null (no throw, no enumeration)", async () => {
  const users = makeUserStore();
  assert.equal(await users.verifyCredentials("ghost@example.com", "whatever"), null);
});

test("user store: duplicate registration is rejected", async () => {
  const users = makeUserStore();
  await users.create("dup@example.com", "password-123");
  await assert.rejects(() => users.create("DUP@example.com", "password-123"));
});

test("G. unknown session id is rejected", async () => {
  const store = getSessionStore();
  assert.equal(await store.get("does-not-exist"), null);
});

test("F. destroy (logout) invalidates the session", async () => {
  const store = getSessionStore();
  const { sid } = await store.create("user_logout");
  assert.ok(await store.get(sid)); // valid before logout
  await store.destroy(sid);
  assert.equal(await store.get(sid), null); // invalid after logout
});

test("session fixation: rotate issues a new id and kills the old one", async () => {
  const store = getSessionStore();
  const { sid: oldSid } = await store.create("user_rotate");
  const { sid: newSid } = await store.rotate(oldSid, "user_rotate");

  assert.notEqual(oldSid, newSid);
  assert.equal(await store.get(oldSid), null); // old id dead
  const rotated = await store.get(newSid);
  assert.ok(rotated);
  assert.equal(rotated?.userId, "user_rotate");
});

test("G. expired session is rejected and cleaned up", async () => {
  // Force a very short TTL for this test.
  const prev = process.env.SESSION_TTL_MS;
  process.env.SESSION_TTL_MS = "1"; // 1ms
  try {
    const store = getSessionStore();
    const { sid } = await store.create("user_expire");
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(await store.get(sid), null);
  } finally {
    if (prev === undefined) delete process.env.SESSION_TTL_MS;
    else process.env.SESSION_TTL_MS = prev;
  }
});
