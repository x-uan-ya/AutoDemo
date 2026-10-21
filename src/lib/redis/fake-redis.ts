import type { RedisLike } from "./client";
import {
  RATE_LIMIT_LUA,
  ACQUIRE_SLOT_LUA,
  RELEASE_SLOT_LUA,
  COUNT_SLOTS_LUA,
} from "./scripts";

/**
 * In-memory RedisLike for tests.
 *
 * It implements the exact Lua scripts in scripts.ts with equivalent JavaScript.
 * Because Node runs this single-threaded and each `eval` runs to completion
 * before any other callback, the operations are atomic — the same guarantee the
 * real Redis gives — which is what lets the concurrency/rate-limit tests model
 * "multiple instances sharing one store" by pointing them all at one fake.
 *
 * Supports a manual clock so expiry can be tested deterministically.
 */
export class FakeRedis implements RedisLike {
  private strings = new Map<string, { value: string; expireAt: number | null }>();
  private zsets = new Map<string, { members: Map<string, number>; expireAt: number | null }>();

  /**
   * Expire a string key relative to a logical clock. Redis scripts carry their
   * own `now` (ms epoch) so expiry is evaluated against the same clock the
   * caller used, not wall-clock — this keeps tests deterministic.
   */
  private sweepStringAt(key: string, now: number): void {
    const e = this.strings.get(key);
    if (e && e.expireAt !== null && e.expireAt <= now) this.strings.delete(key);
  }

  private sweepZsetAt(key: string, now: number): void {
    const z = this.zsets.get(key);
    if (z && z.expireAt !== null && z.expireAt <= now) this.zsets.delete(key);
  }

  async ping(): Promise<string> {
    return "PONG";
  }

  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) {
      if (this.strings.delete(k)) n++;
      if (this.zsets.delete(k)) n++;
    }
    return n;
  }

  async eval(
    script: string,
    _numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown> {
    const key = String(args[0]);
    if (script === RATE_LIMIT_LUA) {
      return this.evalRateLimit(key, Number(args[1]), Number(args[2]));
    }
    if (script === ACQUIRE_SLOT_LUA) {
      return this.evalAcquire(
        key,
        Number(args[1]),
        Number(args[2]),
        String(args[3]),
        Number(args[4])
      );
    }
    if (script === RELEASE_SLOT_LUA) {
      return this.evalRelease(key, String(args[1]));
    }
    if (script === COUNT_SLOTS_LUA) {
      return this.evalCount(key, Number(args[1]));
    }
    throw new Error("FakeRedis: unknown script");
  }

  private evalRateLimit(key: string, windowMs: number, now: number): [number, number] {
    this.sweepStringAt(key, now);
    const resetKey = key + ":reset";
    this.sweepStringAt(resetKey, now);

    const existing = this.strings.get(key);
    let count: number;
    if (!existing) {
      count = 1;
      this.strings.set(key, { value: "1", expireAt: now + windowMs });
      this.strings.set(resetKey, { value: String(now + windowMs), expireAt: now + windowMs });
    } else {
      count = Number(existing.value) + 1;
      existing.value = String(count);
    }
    let resetEntry = this.strings.get(resetKey);
    if (!resetEntry) {
      const resetAt = now + windowMs;
      resetEntry = { value: String(resetAt), expireAt: now + windowMs };
      this.strings.set(resetKey, resetEntry);
    }
    return [count, Number(resetEntry.value)];
  }

  private getZset(key: string) {
    let z = this.zsets.get(key);
    if (!z) {
      z = { members: new Map(), expireAt: null };
      this.zsets.set(key, z);
    }
    return z;
  }

  private pruneExpired(key: string, now: number): void {
    const z = this.zsets.get(key);
    if (!z) return;
    for (const [member, score] of z.members) {
      if (score <= now) z.members.delete(member);
    }
  }

  private evalAcquire(
    key: string,
    max: number,
    now: number,
    leaseId: string,
    ttlMs: number
  ): number {
    this.sweepZsetAt(key, now);
    this.pruneExpired(key, now);
    const z = this.getZset(key);
    if (z.members.size >= max) return 0;
    z.members.set(leaseId, now + ttlMs);
    z.expireAt = now + ttlMs;
    return 1;
  }

  private evalRelease(key: string, leaseId: string): number {
    const z = this.zsets.get(key);
    if (!z) return 0;
    return z.members.delete(leaseId) ? 1 : 0;
  }

  private evalCount(key: string, now: number): number {
    this.pruneExpired(key, now);
    const z = this.zsets.get(key);
    return z ? z.members.size : 0;
  }
}
