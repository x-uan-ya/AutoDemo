import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hashPassword,
  verifyPassword,
  validatePasswordStrength,
  PasswordError,
} from "../password";

/** Password hashing: never plaintext, verifies correctly, rejects tampering. */

test("hash is not the plaintext and is self-describing scrypt", async () => {
  const hash = await hashPassword("correct horse battery");
  assert.notEqual(hash, "correct horse battery");
  assert.ok(hash.startsWith("scrypt$"));
});

test("verifyPassword accepts the right password", async () => {
  const hash = await hashPassword("s3cret-passw0rd");
  assert.equal(await verifyPassword("s3cret-passw0rd", hash), true);
});

test("verifyPassword rejects the wrong password", async () => {
  const hash = await hashPassword("s3cret-passw0rd");
  assert.equal(await verifyPassword("wrong-password", hash), false);
});

test("verifyPassword rejects a malformed stored hash", async () => {
  assert.equal(await verifyPassword("whatever", "not-a-valid-hash"), false);
  assert.equal(await verifyPassword("whatever", ""), false);
});

test("two hashes of the same password differ (random salt)", async () => {
  const a = await hashPassword("same-password-123");
  const b = await hashPassword("same-password-123");
  assert.notEqual(a, b);
});

test("validatePasswordStrength enforces a minimum length", () => {
  assert.ok(validatePasswordStrength("short") !== null);
  assert.equal(validatePasswordStrength("longenough1"), null);
});

test("hashPassword rejects a too-short password", async () => {
  await assert.rejects(() => hashPassword("x"), PasswordError);
});
