import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { ExplorerError } from "./types";

/**
 * Server-side URL validation for the Website Explorer.
 *
 * This is a security boundary, not a convenience check. The explorer opens a
 * real browser against whatever host we approve, so an attacker who can pick
 * the URL could try to reach internal services (SSRF). We therefore:
 *
 *   1. Require the https: scheme (rejecting file:, javascript:, data:, http:).
 *   2. Reject obviously-internal hostnames (localhost, *.local, etc.).
 *   3. Resolve the hostname's DNS records and reject if ANY resolved address
 *      is loopback, private, link-local, unique-local, or a known cloud
 *      metadata address. Resolving up front also defends against a hostname
 *      that looks public but points at an internal IP.
 *
 * Callers should treat a rejected result as "do not open this URL".
 */

export interface UrlValidationResult {
  url: string;
  hostname: string;
  /** Every IP the hostname resolved to (validated as public). */
  resolvedAddresses: string[];
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  // Common cloud metadata hostnames.
  "metadata",
  "metadata.google.internal",
]);

/** Hostname suffixes that indicate internal/private naming. */
const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

/** IPv4 cloud metadata / special addresses that must never be reached. */
const BLOCKED_EXACT_IPV4 = new Set([
  "169.254.169.254", // AWS/GCP/Azure metadata
  "100.100.100.200", // Alibaba Cloud metadata
]);

function parseUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new ExplorerError(
      "invalid_url",
      "That does not look like a valid URL."
    );
  }
  return parsed;
}

function assertHttpsScheme(url: URL): void {
  // Explicitly reject the dangerous schemes the spec calls out, plus anything
  // that is not https.
  if (url.protocol !== "https:") {
    throw new ExplorerError(
      "blocked_url",
      "Only public https:// URLs are allowed."
    );
  }
}

function assertHostnameNotInternal(hostname: string): void {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new ExplorerError("blocked_url", "That host is not allowed.");
  }
  if (BLOCKED_HOSTNAME_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    throw new ExplorerError("blocked_url", "That host is not allowed.");
  }
}

/**
 * Returns true if the given IP (v4 or v6) is one we must not connect to:
 * loopback, private, link-local, unique-local, unspecified, or a metadata
 * address.
 */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedIpv4(address);
  if (family === 6) return isBlockedIpv6(address);
  // Not a recognizable IP: treat as blocked to be safe.
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
  if (a >= 224) return true; // multicast / reserved

  return false;
}

function isBlockedIpv6(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase();

  if (ip === "::" || ip === "::1") return true; // unspecified / loopback

  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIpv4(mapped[1]);

  if (ip.startsWith("fe80")) return true; // link-local
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // unique-local fc00::/7
  if (ip.startsWith("ff")) return true; // multicast

  return false;
}

/**
 * Validate a URL string for exploration. Throws ExplorerError on rejection.
 * On success, returns the normalized URL and the resolved public addresses.
 */
export async function validateExploreUrl(
  raw: string
): Promise<UrlValidationResult> {
  const url = parseUrl(raw);
  assertHttpsScheme(url);

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new ExplorerError("invalid_url", "The URL is missing a host.");
  }
  assertHostnameNotInternal(hostname);

  // If the host is a literal IP, validate it directly.
  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    if (isBlockedAddress(hostname)) {
      throw new ExplorerError(
        "blocked_url",
        "That address points to a private or internal network."
      );
    }
    return { url: url.toString(), hostname, resolvedAddresses: [hostname] };
  }

  // Otherwise resolve DNS and validate every returned address. This is what
  // stops a public-looking hostname that resolves to an internal IP.
  let records: { address: string }[];
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    throw new ExplorerError(
      "unreachable",
      "We could not resolve that domain name."
    );
  }

  if (records.length === 0) {
    throw new ExplorerError(
      "unreachable",
      "We could not resolve that domain name."
    );
  }

  for (const record of records) {
    if (isBlockedAddress(record.address)) {
      throw new ExplorerError(
        "blocked_url",
        "That host resolves to a private or internal address."
      );
    }
  }

  return {
    url: url.toString(),
    hostname,
    resolvedAddresses: records.map((r) => r.address),
  };
}
