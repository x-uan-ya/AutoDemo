import { test } from "node:test";
import assert from "node:assert/strict";
import { guardDemoRoute } from "../route-guard";
import { SEED_OWNER_ID } from "../authz";
import { getUserStore } from "@/lib/auth/user-store";
import { getSessionStore } from "@/lib/auth/session-store";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { CSRF_HEADER } from "@/lib/auth/csrf";
import { getRepository } from "@/lib/repository";
import type { DemoSettings } from "@/types";

/**
 * End-to-end authorization tests through the REAL enforcement choke point
 * (guardDemoRoute). Covers the required matrix:
 *   A. Anonymous cannot access a demo            -> 401
 *   B. Owner can access their own demo           -> allowed (job returned)
 *   C. User A cannot access User B's demo        -> 404 (non-enumerating)
 *   D. Anonymous cannot mutate                   -> 401
 *   E. Non-owner cannot mutate                   -> 404
 *   H. Mutation without a valid CSRF token       -> 403
 * Plus: seed demos are shared to any authenticated user.
 */

const SETTINGS: DemoSettings = {
  websiteUrl: "https://example.com",
  purpose: "product_overview",
  audience: "devs",
  duration: "60s",
  language: "english",
  voice: "professional_female",
  additionalInstructions: "",
};

interface Ctx {
  userId: string;
  sid: string;
  csrf: string;
}

/** Register a fresh user and open a session. Returns ids + csrf token. */
async function makeUser(email: string): Promise<Ctx> {
  const user = await getUserStore().create(email, "password-123");
  const { sid, record } = await getSessionStore().create(user.id);
  return { userId: user.id, sid, csrf: record.csrfToken };
}

/** Build a Request carrying (optionally) a session cookie and CSRF header. */
function request(
  method: string,
  opts: { sid?: string; csrf?: string } = {}
): Request {
  const headers: Record<string, string> = {};
  if (opts.sid) headers["cookie"] = `${SESSION_COOKIE}=${opts.sid}`;
  if (opts.csrf) headers[CSRF_HEADER] = opts.csrf;
  return new Request("https://app.example.com/api/demo/x", { method, headers });
}

// Unique emails per test to avoid duplicate-registration collisions across the
// shared global user store.
let n = 0;
const email = () => `u${Date.now()}_${n++}@example.com`;

test("A. anonymous cannot access a demo -> 401", async () => {
  const owner = await makeUser(email());
  const demo = await getRepository().create(owner.userId, SETTINGS);

  const guard = await guardDemoRoute(request("GET"), demo.id, "default", "/test");
  assert.ok(guard.response);
  assert.equal(guard.response!.status, 401);
});

test("B. owner can access their own demo -> allowed", async () => {
  const owner = await makeUser(email());
  const demo = await getRepository().create(owner.userId, SETTINGS);

  const guard = await guardDemoRoute(
    request("GET", { sid: owner.sid }),
    demo.id,
    "default",
    "/test"
  );
  assert.equal(guard.response, undefined);
  assert.equal(guard.job?.id, demo.id);
});

test("C. user A cannot access user B's demo -> 404 (non-enumerating)", async () => {
  const a = await makeUser(email());
  const b = await makeUser(email());
  const demoB = await getRepository().create(b.userId, SETTINGS);

  const guard = await guardDemoRoute(
    request("GET", { sid: a.sid }),
    demoB.id,
    "default",
    "/test"
  );
  assert.ok(guard.response);
  assert.equal(guard.response!.status, 404);
});

test("non-existent demo also returns 404 (indistinguishable from not-yours)", async () => {
  const a = await makeUser(email());
  const guard = await guardDemoRoute(
    request("GET", { sid: a.sid }),
    "demo_does_not_exist",
    "default",
    "/test"
  );
  assert.ok(guard.response);
  assert.equal(guard.response!.status, 404);
});

test("D. anonymous cannot mutate -> 401", async () => {
  const owner = await makeUser(email());
  const demo = await getRepository().create(owner.userId, SETTINGS);

  // No session at all; method is state-changing.
  const guard = await guardDemoRoute(request("POST"), demo.id, "default", "/test");
  assert.ok(guard.response);
  assert.equal(guard.response!.status, 401);
});

test("E. non-owner cannot mutate another user's demo -> 404", async () => {
  const a = await makeUser(email());
  const b = await makeUser(email());
  const demoB = await getRepository().create(b.userId, SETTINGS);

  // Authenticated as A with a valid CSRF token, but demo belongs to B.
  const guard = await guardDemoRoute(
    request("POST", { sid: a.sid, csrf: a.csrf }),
    demoB.id,
    "default",
    "/test"
  );
  assert.ok(guard.response);
  assert.equal(guard.response!.status, 404);
});

test("H. mutation without a valid CSRF token -> 403", async () => {
  const owner = await makeUser(email());
  const demo = await getRepository().create(owner.userId, SETTINGS);

  // Authenticated as the owner, but no CSRF header on a POST.
  const guard = await guardDemoRoute(
    request("POST", { sid: owner.sid }),
    demo.id,
    "default",
    "/test"
  );
  assert.ok(guard.response);
  assert.equal(guard.response!.status, 403);
});

test("owner mutation WITH a valid CSRF token is allowed", async () => {
  const owner = await makeUser(email());
  const demo = await getRepository().create(owner.userId, SETTINGS);

  const guard = await guardDemoRoute(
    request("POST", { sid: owner.sid, csrf: owner.csrf }),
    demo.id,
    "default",
    "/test"
  );
  assert.equal(guard.response, undefined);
  assert.equal(guard.job?.id, demo.id);
});

test("seed demos are shared to any authenticated user", async () => {
  const someone = await makeUser(email());
  // The repository is seeded with demo_a1b2c3 owned by SEED_OWNER_ID.
  const seed = await getRepository().getById("demo_a1b2c3");
  assert.equal(seed?.ownerId, SEED_OWNER_ID);

  const guard = await guardDemoRoute(
    request("GET", { sid: someone.sid }),
    "demo_a1b2c3",
    "default",
    "/test"
  );
  assert.equal(guard.response, undefined);
  assert.equal(guard.job?.id, "demo_a1b2c3");
});

test("expired/invalid session is treated as anonymous -> 401", async () => {
  const owner = await makeUser(email());
  const demo = await getRepository().create(owner.userId, SETTINGS);

  // A syntactically plausible but unknown session id.
  const guard = await guardDemoRoute(
    request("GET", { sid: "totally-bogus-session-id" }),
    demo.id,
    "default",
    "/test"
  );
  assert.ok(guard.response);
  assert.equal(guard.response!.status, 401);
});
