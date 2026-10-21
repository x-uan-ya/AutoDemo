import { test } from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit, __setRateLimitStore, type RateLimitStore } from "../rate-limit";

/**
 * Wiring-level tests for the public rate-limit API:
 *   - a Redis-like shared store is used end-to-end via checkRateLimit
 *   - FAIL-CLOSED: if the store throws (Redis down), the request is NOT allowed
 */

/** A shared store two "requests" both hit — models a shared Redis counter. */
class SharedCountingStore implements RateLimitStore {
  private counters = new Map<string, number>();
  async hit(key: string, windowMs: number) {
    const n = (this.counters.get(key) ?? 0) + 1;
    this.counters.set(key, n);
    return { count: n, resetAt: Date.now() + windowMs };
  }
}

/** A store that always errors — simulates Redis being unavailable. */
class BrokenStore implements RateLimitStore {
  async hit(): Promise<{ count: number; resetAt: number }> {
    throw new Error("redis down");
  }
}

test("checkRateLimit consumes a shared counter across calls", async () => {
  __setRateLimitStore(new SharedCountingStore());
  try {
    // login bucket max = 10
    let last = await checkRateLimit("login", "shared-key");
    for (let i = 0; i < 9; i++) last = await checkRateLimit("login", "shared-key");
    assert.equal(last.ok, true); // 10th still ok
    const over = await checkRateLimit("login", "shared-key"); // 11th
    assert.equal(over.ok, false);
    assert.equal(over.remaining, 0);
  } finally {
    __setRateLimitStore(null);
  }
});

test("FAIL-CLOSED: when the store errors, requests are denied (not allowed)", async () => {
  __setRateLimitStore(new BrokenStore());
  try {
    const result = await checkRateLimit("login", "any-key");
    assert.equal(result.ok, false); // Redis down must NOT mean "no limit"
    assert.ok(result.retryAfterSec >= 1);
  } finally {
    __setRateLimitStore(null);
  }
});
