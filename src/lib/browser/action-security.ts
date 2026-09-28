import { isIP } from "node:net";
import { isBlockedAddress } from "./url-validator";
import type { BrowserAction } from "./types";

/**
 * Phase 4 security helpers for browser actions.
 *
 * Two concerns:
 *  1. Navigation safety — a `navigate` action may only target the approved
 *     website's domain over https, and never an internal/blocked host. This
 *     reuses the SSRF blocklist from url-validator.ts.
 *  2. Destructive-intent flagging — actions whose description/selector suggest
 *     a destructive or sensitive operation (delete, checkout, logout, payment,
 *     etc.) are flagged `requiresHumanApproval` and are NOT auto-executed.
 *
 * All of this runs server-side. The executor consults these helpers before
 * touching the page.
 */

// ---------------------------------------------------------------------------
// Blocked schemes / hosts for navigation
// ---------------------------------------------------------------------------

/** Schemes that must never be navigated to. */
const BLOCKED_SCHEMES = [
  "javascript:",
  "data:",
  "file:",
  "chrome:",
  "about:",
  "vbscript:",
  "blob:",
  "ftp:",
];

/** Hostnames that are never allowed as navigation targets. */
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "ip6-localhost",
  "ip6-loopback",
  "metadata",
  "metadata.google.internal",
  "0.0.0.0",
]);

const BLOCKED_HOSTNAME_SUFFIXES = [".local", ".internal", ".localhost"];

export interface NavigationCheck {
  allowed: boolean;
  reason?: string;
}

/**
 * Return the registrable-ish base domain for same-site comparison. We treat a
 * navigation as same-site when the target host equals the approved host or is a
 * subdomain of it (e.g. approved `example.com` allows `docs.example.com`).
 */
function isSameSite(approvedHost: string, targetHost: string): boolean {
  const a = approvedHost.toLowerCase().replace(/^www\./, "");
  const t = targetHost.toLowerCase().replace(/^www\./, "");
  return t === a || t.endsWith("." + a);
}

/**
 * Validate a navigation target against the approved website.
 *
 * SECURITY: rejects non-https schemes, internal/blocked hostnames, literal
 * private IPs, and any host outside the approved domain. Note this does NOT do
 * DNS resolution (that is async and done by the explorer's validateExploreUrl
 * when a page is first opened); here we enforce scheme, host allowlist, literal
 * IP blocklist, and same-domain policy synchronously before each navigation.
 */
export function checkNavigationTarget(
  targetUrl: string,
  approvedWebsiteUrl: string
): NavigationCheck {
  let target: URL;
  try {
    target = new URL(targetUrl);
  } catch {
    return { allowed: false, reason: "Navigation URL is not a valid URL." };
  }

  if (BLOCKED_SCHEMES.includes(target.protocol)) {
    return {
      allowed: false,
      reason: `Scheme "${target.protocol}" is not allowed for navigation.`,
    };
  }
  if (target.protocol !== "https:") {
    return { allowed: false, reason: "Navigation must use https." };
  }

  const host = target.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    return { allowed: false, reason: "That host is not allowed." };
  }
  if (BLOCKED_HOSTNAME_SUFFIXES.some((s) => host.endsWith(s))) {
    return { allowed: false, reason: "Internal hostnames are not allowed." };
  }
  // Literal private/loopback/metadata IPs. Only apply the IP blocklist when the
  // host is actually an IP literal — isBlockedAddress() treats non-IP strings
  // (i.e. real hostnames like example.com) as "blocked" by safe default, so we
  // must guard with isIP first. DNS-based SSRF checks for hostnames happen when
  // the page is first opened (validateExploreUrl); here we enforce scheme,
  // host allowlist, literal-IP blocklist, and same-domain policy.
  if (isIP(host) !== 0 && isBlockedAddress(host)) {
    return {
      allowed: false,
      reason: "That address points to a private or internal network.",
    };
  }

  // Domain scoping: stay on the approved website unless explicitly widened
  // later (not configurable yet — Phase 4 keeps navigation on-domain).
  let approvedHost: string;
  try {
    approvedHost = new URL(approvedWebsiteUrl).hostname;
  } catch {
    return { allowed: false, reason: "Approved website URL is invalid." };
  }
  if (!isSameSite(approvedHost, host)) {
    return {
      allowed: false,
      reason: `Navigation is restricted to ${approvedHost}. "${host}" is off-domain.`,
    };
  }

  return { allowed: true };
}

// ---------------------------------------------------------------------------
// Destructive / sensitive intent flagging
// ---------------------------------------------------------------------------

/**
 * Keywords that indicate a potentially destructive or sensitive operation.
 * Actions matching these are flagged for human approval rather than executed
 * automatically. Matched against the action's selector/description/value.
 */
const DESTRUCTIVE_KEYWORDS: { re: RegExp; reason: string }[] = [
  { re: /\bdelete\b/i, reason: "delete" },
  { re: /remove account/i, reason: "remove account" },
  { re: /\blog\s?out\b|\bsign\s?out\b/i, reason: "logout" },
  { re: /\bcheckout\b/i, reason: "checkout" },
  { re: /\bpayment\b|\bpay now\b|\bcard number\b/i, reason: "payment" },
  { re: /\bpurchase\b|\bbuy now\b|\bplace order\b/i, reason: "purchase" },
  { re: /\bsend\b/i, reason: "send" },
  { re: /\bpublish\b/i, reason: "publish" },
  { re: /change password/i, reason: "change password" },
  { re: /account settings/i, reason: "account settings" },
  { re: /\bsubscribe\b|\bconfirm\b.*\border\b/i, reason: "subscribe/confirm order" },
  { re: /\bcancel (account|subscription)\b/i, reason: "cancel account/subscription" },
];

/**
 * Inspect an action for destructive/sensitive intent. Returns a reason string
 * when flagged, or null when the action is considered safe to run.
 *
 * Only actions that actually DO something on the page are considered
 * (click/fill/select/press). Navigation/scroll/hover/wait/screenshot are not
 * destructive by themselves.
 */
export function flagDestructiveAction(action: BrowserAction): string | null {
  const haystacks: string[] = [];
  switch (action.type) {
    case "click":
    case "hover":
      haystacks.push(action.selector, action.description);
      break;
    case "fill":
    case "select":
      haystacks.push(action.selector, action.description, action.value);
      break;
    case "press":
      // "Enter" on a payment form is risky, but we only have the key here; the
      // surrounding click/fill actions carry the real signal. Do not flag bare
      // key presses.
      return null;
    default:
      return null;
  }

  const text = haystacks.join(" ");
  for (const { re, reason } of DESTRUCTIVE_KEYWORDS) {
    if (re.test(text)) return reason;
  }
  return null;
}
