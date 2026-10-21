/**
 * Lua scripts for atomic shared-state operations.
 *
 * Each script runs atomically inside Redis (single-threaded execution), so
 * concurrent application instances cannot race between a read and a write. The
 * same script source is used by the real ioredis client and by the in-memory
 * fake used in tests, so both exercise identical semantics.
 */

/**
 * Fixed-window rate limit.
 *   KEYS[1] = counter key
 *   ARGV[1] = window ms
 *   ARGV[2] = now (ms epoch)
 * Returns: { count, resetAt }
 *
 * Increments the counter; on first hit sets PEXPIRE to the window and records
 * the reset time in a sibling key. TTL makes stale keys disappear on their own.
 */
export const RATE_LIMIT_LUA = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local resetKey = key .. ":reset"

local count = redis.call("INCR", key)
if count == 1 then
  redis.call("PEXPIRE", key, windowMs)
  redis.call("SET", resetKey, now + windowMs, "PX", windowMs)
end
local resetAt = redis.call("GET", resetKey)
if not resetAt then
  resetAt = now + windowMs
  redis.call("SET", resetKey, resetAt, "PX", windowMs)
end
return { count, tonumber(resetAt) }
`;

/**
 * Acquire a concurrency-gate lease.
 *   KEYS[1] = set key holding active lease ids (sorted set: member=leaseId, score=expiry)
 *   ARGV[1] = max concurrent
 *   ARGV[2] = now (ms epoch)
 *   ARGV[3] = lease id (unique)
 *   ARGV[4] = lease ttl ms
 * Returns: 1 if acquired, 0 if at capacity.
 *
 * First prunes expired leases (score < now) so crashed workers cannot hold a
 * slot forever. Then, if capacity remains, adds this lease with an expiry
 * score and sets a key TTL so the whole set self-cleans.
 */
export const ACQUIRE_SLOT_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local leaseId = ARGV[3]
local ttlMs = tonumber(ARGV[4])

redis.call("ZREMRANGEBYSCORE", key, "-inf", now)
local current = redis.call("ZCARD", key)
if current >= max then
  return 0
end
redis.call("ZADD", key, now + ttlMs, leaseId)
redis.call("PEXPIRE", key, ttlMs)
return 1
`;

/**
 * Release a concurrency-gate lease.
 *   KEYS[1] = set key
 *   ARGV[1] = lease id
 * Returns: number removed (1 if this lease was present, else 0).
 *
 * Only removes THIS lease id, so one worker can never release another's slot.
 */
export const RELEASE_SLOT_LUA = `
return redis.call("ZREM", KEYS[1], ARGV[1])
`;

/**
 * Count live leases (for diagnostics/tests).
 *   KEYS[1] = set key
 *   ARGV[1] = now
 */
export const COUNT_SLOTS_LUA = `
redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
return redis.call("ZCARD", KEYS[1])
`;
