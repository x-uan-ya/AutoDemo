import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { MAX_URL_LENGTH } from "./limits";

/**
 * Central SSRF-safe URL validator.
 *
 * This is THE single source of truth for deciding whether a URL may be opened
 * server-side (by Playwright) on behalf of an untrusted user. It is a security
 * boundary, not a convenience check.
 *
 * Policy:
 *   - Allow only http: and https: schemes.
 *   - Reject file:, ftp:, javascript:, data:, blob:, chrome:, about:, etc.
 *   - Reject localhost and internal hostname patterns.
 *   - Resolve DNS and reject if ANY resolved address is loopback, private,
 *     link-local, unique-local, CGNAT, multicast, broadcast, unspecified, or a
 *     cloud metadata address — for both IPv4 and IPv6.
 *   - Enforce a maximum URL length.
 *
 * DNS rebinding: resolving up front defends against a public-looking hostname
 * that points at an internal IP. Callers that navigate (Playwright) must ALSO
 * re-validate the final URL and every redirect hop, because the OS resolver may
 * return a different address at navigation time (documented residual risk).
 */

export class UrlSecurityError extends Error {
  code:
    | "invalid_url"
    | "too_long"
    | "blocked_scheme"
    | "blocked_host"
    | "unreachable"
    | "private_address";

  constructor(code: UrlSecurityError["code"], message: string) {
    super(message);
    this.name = "UrlSecurityError";
    this.code = code;
  }
}

export interface UrlValidationResult {
  /** Normalized URL string. */
  url: string;
  hostname: string;
  scheme: "http:" | "https:";
  /** Every IP the hostname resolved to (all validated as public). */
  resolvedAddresses: string[];
}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/** Hostname suffixes that indicate internal/private naming. */
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

/** Cloud metadata / special addresses that must never be reached. */
const BLOCKED_EXACT_IPV4 = new Set([
  "169.254.169.254", // AWS/GCP/Azure/OpenStack metadata
  "100.100.100.200", // Alibaba Cloud metadata
  "192.0.0.192", // Oracle Cloud metadata
]);

function parseUrl(raw: string): URL {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new UrlSecurityError("invalid_url", "A URL is required.");
  }
  if (trimmed.length > MAX_URL_LENGTH) {
    throw new UrlSecurityError(
      "too_long",
      `URL exceeds the maximum length of ${MAX_URL_LENGTH} characters.`
    );
  }
  try {
    return new URL(trimmed);
  } catch {
    throw new UrlSecurityError("invalid_url", "That does not look like a valid URL.");
  }
}

function assertAllowedScheme(url: URL): "http:" | "https:" {
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new UrlSecurityError(
      "blocked_scheme",
      `Only http:// and https:// URLs are allowed (got "${url.protocol}").`
    );
  }
  return url.protocol as "http:" | "https:";
}

function assertHostnameNotInternal(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new UrlSecurityError("blocked_host", "That host is not allowed.");
  }
  if (BLOCKED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new UrlSecurityError("blocked_host", "Internal hostnames are not allowed.");
  }
}

/**
 * Returns true if the given IP (v4 or v6) must not be connected to: loopback,
 * private, link-local, unique-local, CGNAT, multicast, broadcast, unspecified,
 * or a cloud metadata address. Non-IP input is treated as blocked (safe default
 * — callers must guard with isIP() when passing hostnames).
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  return true;
}

function isBlockedIpv4(ip: string): boolean {
  if (BLOCKED_EXACT_IPV4.has(ip)) return true;

  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + metadata handled above
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  if (ip === "255.255.255.255") return true; // broadcast

  return false;
}

function isBlockedIpv6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, "");

  if (ip === "::" || ip === "::1") return true; // unspecified / loopback

  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (ip.startsWith("fe80")) return true; // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local fc00::/7
  if (ip.startsWith("ff")) return true; // multicast
  if (ip.startsWith("::ffff:")) return true; // other v4-mapped forms — be safe

  return false;
}

/**
 * Synchronous host check (no DNS). Validates scheme + hostname patterns +
 * literal-IP blocklist. Used to validate redirect targets before the async DNS
 * check, and by navigation guards that must decide quickly.
 */
export function isHostAllowedSync(rawUrl: string): { allowed: boolean; reason?: string } {
  let url: URL;
  try {
    url = parseUrl(rawUrl);
  } catch (e) {
    return { allowed: false, reason: e instanceof Error ? e.message : "invalid url" };
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    return { allowed: false, reason: `scheme ${url.protocol} not allowed` };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) return { allowed: false, reason: "blocked host" };
  if (BLOCKED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) {
    return { allowed: false, reason: "internal hostname" };
  }
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    return { allowed: false, reason: "private/internal address" };
  }
  return { allowed: true };
}

/**
 * Full async validation (scheme + hostname + DNS resolution). Throws
 * UrlSecurityError on rejection. On success, returns the normalized URL and the
 * resolved public addresses.
 */
export async function validatePublicUrl(raw: string): Promise<UrlValidationResult> {
  const url = parseUrl(raw);
  const scheme = assertAllowedScheme(url);

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new UrlSecurityError("invalid_url", "The URL is missing a host.");
  }
  assertHostnameNotInternal(hostname);

  // Literal IP host: validate directly, no DNS.
  const literalFamily = isIP(hostname.replace(/^\[|\]$/g, ""));
  if (literalFamily !== 0) {
    const ip = hostname.replace(/^\[|\]$/g, "");
    if (isBlockedAddress(ip)) {
      throw new UrlSecurityError(
        "private_address",
        "That address points to a private or internal network."
      );
    }
    return { url: url.toString(), hostname, scheme, resolvedAddresses: [ip] };
  }

  // Resolve DNS and validate every returned address.
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new UrlSecurityError("unreachable", "We could not resolve that domain name.");
  }
  if (records.length === 0) {
    throw new UrlSecurityError("unreachable", "We could not resolve that domain name.");
  }
  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new UrlSecurityError(
        "private_address",
        "That host resolves to a private or internal address."
      );
    }
  }

  return {
    url: url.toString(),
    hostname,
    scheme,
    resolvedAddresses: records.map((r) => r.address),
  };
}
