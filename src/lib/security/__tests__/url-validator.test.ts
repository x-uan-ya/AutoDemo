import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validatePublicUrl,
  isHostAllowedSync,
  isBlockedAddress,
  UrlSecurityError,
} from "../url-validator";

/**
 * SSRF / URL-validation security tests.
 *
 * These assert that the single source of truth for "may we open this URL
 * server-side?" rejects the attacks it is meant to stop. They use literal-IP
 * and non-http scheme inputs so they do not depend on live DNS.
 */

// --- Scheme rejection ------------------------------------------------------

test("rejects file:// scheme", async () => {
  await assert.rejects(
    () => validatePublicUrl("file:///etc/passwd"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "blocked_scheme"
  );
});

test("rejects javascript: scheme", async () => {
  await assert.rejects(
    () => validatePublicUrl("javascript:alert(1)"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "blocked_scheme"
  );
});

test("rejects data: scheme", async () => {
  await assert.rejects(
    () => validatePublicUrl("data:text/html,<script>alert(1)</script>"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "blocked_scheme"
  );
});

test("rejects ftp: scheme", async () => {
  await assert.rejects(
    () => validatePublicUrl("ftp://example.com/x"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "blocked_scheme"
  );
});

// --- Internal hostnames ----------------------------------------------------

test("rejects http://localhost", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://localhost/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "blocked_host"
  );
});

test("rejects *.internal hostnames", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://db.internal/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "blocked_host"
  );
});

test("rejects *.local hostnames", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://printer.local/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "blocked_host"
  );
});

// --- Literal private / loopback IPs ---------------------------------------

test("rejects 127.0.0.1 loopback", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://127.0.0.1/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "private_address"
  );
});

test("rejects 10.0.0.1 private", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://10.0.0.1/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "private_address"
  );
});

test("rejects 192.168.1.1 private", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://192.168.1.1/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "private_address"
  );
});

test("rejects 172.16.0.1 private", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://172.16.0.1/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "private_address"
  );
});

test("rejects 169.254.169.254 cloud metadata", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://169.254.169.254/latest/meta-data/"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "private_address"
  );
});

test("rejects IPv6 loopback [::1]", async () => {
  await assert.rejects(
    () => validatePublicUrl("http://[::1]/"),
    (e: unknown) => e instanceof UrlSecurityError
  );
});

// --- Length / malformed ----------------------------------------------------

test("rejects oversized URL", async () => {
  const huge = "http://example.com/" + "a".repeat(5000);
  await assert.rejects(
    () => validatePublicUrl(huge),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "too_long"
  );
});

test("rejects empty URL", async () => {
  await assert.rejects(
    () => validatePublicUrl("   "),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "invalid_url"
  );
});

test("rejects malformed URL", async () => {
  await assert.rejects(
    () => validatePublicUrl("not a url at all"),
    (e: unknown) => e instanceof UrlSecurityError && e.code === "invalid_url"
  );
});

// --- isBlockedAddress unit checks -----------------------------------------

test("isBlockedAddress flags private/loopback/metadata and allows public", () => {
  assert.equal(isBlockedAddress("127.0.0.1"), true);
  assert.equal(isBlockedAddress("10.1.2.3"), true);
  assert.equal(isBlockedAddress("192.168.0.5"), true);
  assert.equal(isBlockedAddress("172.20.0.1"), true);
  assert.equal(isBlockedAddress("169.254.169.254"), true);
  assert.equal(isBlockedAddress("100.64.0.1"), true); // CGNAT
  assert.equal(isBlockedAddress("::1"), true);
  assert.equal(isBlockedAddress("fe80::1"), true);
  assert.equal(isBlockedAddress("fd00::1"), true);
  assert.equal(isBlockedAddress("not-an-ip"), true); // safe default

  // Public addresses are allowed.
  assert.equal(isBlockedAddress("8.8.8.8"), false);
  assert.equal(isBlockedAddress("1.1.1.1"), false);
  assert.equal(isBlockedAddress("93.184.216.34"), false); // example.com
});

// --- isHostAllowedSync (redirect/navigation guard) ------------------------

test("isHostAllowedSync blocks private redirect targets", () => {
  assert.equal(isHostAllowedSync("http://127.0.0.1/").allowed, false);
  assert.equal(isHostAllowedSync("http://169.254.169.254/").allowed, false);
  assert.equal(isHostAllowedSync("http://localhost/").allowed, false);
  assert.equal(isHostAllowedSync("file:///etc/passwd").allowed, false);
  assert.equal(isHostAllowedSync("http://10.0.0.1/").allowed, false);
});

test("isHostAllowedSync allows public literal IP and hostname", () => {
  assert.equal(isHostAllowedSync("http://8.8.8.8/").allowed, true);
  assert.equal(isHostAllowedSync("https://example.com/path").allowed, true);
});
