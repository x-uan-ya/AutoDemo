import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeRedis } from "../fake-redis";
import {
  RATE_LIMIT_LUA,
  ACQUIRE_SLOT_LUA,
  RELEASE_SLOT_LUA,
  COUNT_SLOTS_LUA,
} from "../scripts";

/**
 * These tests drive the exact Lua scripts through a single FakeRedis instance.
 * A single shared store models "multiple application instances talking to one
 * Redis": every simulated instance runs the same atomic script against the same
 * keys, so whatever these tests prove about the scripts holds across instances.
 */

// ---- helpers ---------------------------------------------------------------

async function hit(redis: FakeRedis, key: string, windowMs: number, now: number) {
  const r = (await redis.eval(RATE_LIMIT_LUA, 1, key, windowMs, now)) as [number, number];
  return { count: Number(r[0]), resetAt: Number(r[1]) };
}

async function acquire(
  redis: FakeRedis,
  key: string,
  max: number,
  now: number,
  leaseId: string,
  ttlMs: number
): Promise<boolean> {
  const ok = (await redis.eval(ACQUIRE_SLOT_LUA, 1, key, max, now, leaseId, ttlMs)) as number;
  return Number(ok) === 1;
}

async function release(redis: FakeRedis, key: string, leaseId: string): Promise<number> {
  return Number(await redis.eval(RELEASE_SLOT_LUA, 1, key, leaseId));
}

async function count(redis: FakeRedis, key: string, now: number): Promise<number> {
  return Number(await redis.eval(COUNT_SLOTS_LUA, 1, key, now));
}

// ===== RATE LIMITER =========================================================

test("rate limit: instance A and instance B share the same counter", async () => {
  const redis = new FakeRedis(); // one Redis, two "instances"
  const key = "login:1.2.3.4";
  const win = 60_000;
  const now = 1_000_000;

  // Instance A makes 3 hits, instance B makes 2 — all count toward one total.
  for (let i = 0; i < 3; i++) await hit(redis, key, win, now); // "A"
  const b1 = await hit(redis, key, win, now); // "B"
  const b2 = await hit(redis, key, win, now); // "B"

  assert.equal(b1.count, 4);
  assert.equal(b2.count, 5); // shared, not per-instance
});

test("rate limit: a request on A counts toward the limit seen on B", async () => {
  const redis = new FakeRedis();
  const key = "explore:ip";
  const win = 60_000;
  const now = 2_000_000;
  const max = 10;

  // 10 hits from "A" exhaust the window.
  let last = { count: 0, resetAt: 0 };
  for (let i = 0; i < max; i++) last = await hit(redis, key, win, now);
  assert.equal(last.count <= max, true);

  // "B"'s next hit is the 11th -> over the limit.
  const bHit = await hit(redis, key, win, now);
  assert.equal(bHit.count, 11);
  assert.equal(bHit.count > max, true);
});

test("rate limit: expiry resets the window", async () => {
  const redis = new FakeRedis();
  const key = "render:ip";
  const win = 1_000;

  const first = await hit(redis, key, win, 10_000);
  assert.equal(first.count, 1);

  // A second hit inside the window increments.
  const second = await hit(redis, key, win, 10_500);
  assert.equal(second.count, 2);

  // After the window passes, the key TTL has elapsed -> counter resets to 1.
  const afterExpiry = await hit(redis, key, win, 10_000 + win + 1);
  assert.equal(afterExpiry.count, 1);
});

test("rate limit: many concurrent increments do not bypass the limit", async () => {
  const redis = new FakeRedis();
  const key = "actions:ip";
  const win = 60_000;
  const now = 3_000_000;

  // Fire 50 hits "concurrently" (Promise.all). Atomic INCR must yield exactly
  // one of each count 1..50 with none lost or duplicated.
  const results = await Promise.all(
    Array.from({ length: 50 }, () => hit(redis, key, win, now))
  );
  const counts = results.map((r) => r.count).sort((a, b) => a - b);
  assert.deepEqual(counts, Array.from({ length: 50 }, (_, i) => i + 1));
});

// ===== CONCURRENCY GATE =====================================================

test("concurrency: A acquiring a slot reduces availability for B", async () => {
  const redis = new FakeRedis();
  const key = "slots";
  const max = 2;
  const now = 5_000_000;
  const ttl = 60_000;

  assert.equal(await acquire(redis, key, max, now, "a", ttl), true);
  assert.equal(await acquire(redis, key, max, now, "b", ttl), true);
  // Third acquire (from "C") must be refused — global cap reached.
  assert.equal(await acquire(redis, key, max, now, "c", ttl), false);
  assert.equal(await count(redis, key, now), 2);
});

test("concurrency: the global max cannot be exceeded under concurrent acquires", async () => {
  const redis = new FakeRedis();
  const key = "slots2";
  const max = 3;
  const now = 6_000_000;
  const ttl = 60_000;

  const outcomes = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      acquire(redis, key, max, now, `lease-${i}`, ttl)
    )
  );
  const granted = outcomes.filter(Boolean).length;
  assert.equal(granted, max); // never more than the cap
  assert.equal(await count(redis, key, now), max);
});

test("concurrency: releasing a lease restores capacity", async () => {
  const redis = new FakeRedis();
  const key = "slots3";
  const max = 1;
  const now = 7_000_000;
  const ttl = 60_000;

  assert.equal(await acquire(redis, key, max, now, "x", ttl), true);
  assert.equal(await acquire(redis, key, max, now, "y", ttl), false); // full
  assert.equal(await release(redis, key, "x"), 1); // free the slot
  assert.equal(await acquire(redis, key, max, now, "y", ttl), true); // now fits
});

test("concurrency: an expired/crashed lease eventually frees the slot", async () => {
  const redis = new FakeRedis();
  const key = "slots4";
  const max = 1;
  const ttl = 1_000;
  const t0 = 8_000_000;

  // "Crashed" worker acquires but never releases.
  assert.equal(await acquire(redis, key, max, t0, "crashed", ttl), true);
  // Immediately after, still full.
  assert.equal(await acquire(redis, key, max, t0, "next", ttl), false);
  // After the lease TTL, the expired lease is pruned and the slot is reusable.
  const later = t0 + ttl + 1;
  assert.equal(await acquire(redis, key, max, later, "next", ttl), true);
});

test("concurrency: one worker cannot release another worker's lease", async () => {
  const redis = new FakeRedis();
  const key = "slots5";
  const max = 1;
  const now = 9_000_000;
  const ttl = 60_000;

  assert.equal(await acquire(redis, key, max, now, "owner", ttl), true);
  // Someone else tries to release with the wrong lease id -> no-op.
  assert.equal(await release(redis, key, "intruder"), 0);
  assert.equal(await count(redis, key, now), 1); // owner's slot intact
  // The slot is still held; a new acquire is refused.
  assert.equal(await acquire(redis, key, max, now, "other", ttl), false);
});
