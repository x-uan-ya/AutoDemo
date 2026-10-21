import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyCsrf, isSafeMethod, CSRF_HEADER } from "../csrf";
import type { SessionRecord } from "../session-store";

function session(csrfToken: string): SessionRecord {
  return {
    userId: "u1",
    csrfToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
}

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request("https://app.example.com/api/demo/x/record", { method, headers });
}

test("safe methods never require a CSRF token", () => {
  assert.ok(isSafeMethod("GET"));
  assert.equal(verifyCsrf(req("GET"), session("tok")), true);
  assert.equal(verifyCsrf(req("HEAD"), session("tok")), true);
  assert.equal(verifyCsrf(req("OPTIONS"), session("tok")), true);
});

test("H. unsafe method without a CSRF token is rejected", () => {
  assert.equal(verifyCsrf(req("POST"), session("tok")), false);
  assert.equal(verifyCsrf(req("PUT"), session("tok")), false);
  assert.equal(verifyCsrf(req("DELETE"), session("tok")), false);
});

test("H. unsafe method with a WRONG CSRF token is rejected", () => {
  assert.equal(
    verifyCsrf(req("POST", { [CSRF_HEADER]: "wrong" }), session("right")),
    false
  );
});

test("unsafe method with the matching CSRF token passes", () => {
  assert.equal(
    verifyCsrf(req("POST", { [CSRF_HEADER]: "right" }), session("right")),
    true
  );
});
