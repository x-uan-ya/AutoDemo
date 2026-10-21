import { test } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { checkRateLimit, RATE_LIMITS } from "../rate-limit";

/**
 * I. CORS: unauthorized origins are not granted CORS access; allowlisted
 *    origins are reflected with credentials.
 * J. Login rate limiting actually trips after the configured number of hits.
 */

function corsRequest(method: string, origin?: string): NextRequest {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  return new NextRequest("https://app.example.com/api/auth/login", {
    method,
    headers,
  });
}

test("I. disallowed origin receives NO Access-Control-Allow-Origin header", () => {
  const prev = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = "https://good.example.com";
  try {
    const res = proxy(corsRequest("GET", "https://evil.example.com"));
    assert.equal(res.headers.get("access-control-allow-origin"), null);
  } finally {
    if (prev === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = prev;
  }
});

test("I. disallowed origin preflight is refused with 403", () => {
  const prev = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = "https://good.example.com";
  try {
    const res = proxy(corsRequest("OPTIONS", "https://evil.example.com"));
    assert.equal(res.status, 403);
  } finally {
    if (prev === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = prev;
  }
});

test("I. allowlisted origin is reflected with credentials", () => {
  const prev = process.env.CORS_ALLOWED_ORIGINS;
  process.env.CORS_ALLOWED_ORIGINS = "https://good.example.com";
  try {
    const res = proxy(corsRequest("GET", "https://good.example.com"));
    assert.equal(
      res.headers.get("access-control-allow-origin"),
      "https://good.example.com"
    );
    assert.equal(res.headers.get("access-control-allow-credentials"), "true");
  } finally {
    if (prev === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
    else process.env.CORS_ALLOWED_ORIGINS = prev;
  }
});

test("same-origin request (no Origin header) passes through untouched", () => {
  const res = proxy(corsRequest("GET"));
  assert.equal(res.headers.get("access-control-allow-origin"), null);
});

test("J. login rate limiting trips after the configured number of attempts", async () => {
  const bucket = "login" as const;
  const max = RATE_LIMITS[bucket].max;
  // Unique key so this test is independent of others.
  const key = `test-login-${Date.now()}`;

  let lastOk = true;
  for (let i = 0; i < max; i++) {
    const r = await checkRateLimit(bucket, key);
    lastOk = r.ok;
  }
  // The max-th request is still allowed...
  assert.equal(lastOk, true);

  // ...the next one is blocked.
  const blocked = await checkRateLimit(bucket, key);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
});
