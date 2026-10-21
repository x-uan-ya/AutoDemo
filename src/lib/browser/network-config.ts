import type { LaunchOptions } from "playwright";

/**
 * Externally-configurable network settings for the browser worker.
 *
 * IMPORTANT: this module does NOT and CANNOT enforce network isolation. It only
 * exposes hooks so that the surrounding infrastructure (an egress firewall, a
 * forward proxy, a locked-down subnet/VPC) can be wired in via environment
 * variables without code changes. The authoritative egress controls live in the
 * network layer — see the "Browser Network Isolation" section of SECURITY.md.
 *
 * Why this exists:
 *   - Application-level SSRF validation and the per-request Playwright guards
 *     are DEFENSE IN DEPTH. They cannot fully eliminate DNS-rebinding, because
 *     Chromium resolves hostnames itself at navigation time and may connect to
 *     an address different from the one we validated.
 *   - The real boundary is a network environment where private/internal ranges
 *     and cloud metadata endpoints are simply unreachable from the browser.
 *   - When the browser egresses through a controlled forward proxy, set
 *     BROWSER_PROXY_SERVER so all browser traffic is forced through it; the
 *     proxy/firewall then enforces the egress policy regardless of DNS.
 *
 * Supported environment variables:
 *   - BROWSER_PROXY_SERVER   e.g. "http://egress-proxy.internal:3128"
 *   - BROWSER_PROXY_BYPASS   comma/semicolon list passed to Playwright's
 *                            proxy.bypass (hosts that skip the proxy)
 */

export interface BrowserNetworkConfig {
  /** Optional forward proxy all browser traffic must egress through. */
  proxyServer?: string;
  /** Optional proxy bypass list. */
  proxyBypass?: string;
}

export function getBrowserNetworkConfig(): BrowserNetworkConfig {
  const proxyServer = process.env.BROWSER_PROXY_SERVER?.trim() || undefined;
  const proxyBypass = process.env.BROWSER_PROXY_BYPASS?.trim() || undefined;
  return { proxyServer, proxyBypass };
}

/**
 * Build the `proxy` portion of Playwright launch options from the environment.
 * Returns {} when no proxy is configured (same-network direct egress — in that
 * case the subnet/VPC firewall must enforce the egress policy).
 */
export function browserProxyLaunchOptions(): Pick<LaunchOptions, "proxy"> {
  const { proxyServer, proxyBypass } = getBrowserNetworkConfig();
  if (!proxyServer) return {};
  return {
    proxy: {
      server: proxyServer,
      ...(proxyBypass ? { bypass: proxyBypass } : {}),
    },
  };
}

/** True when an egress proxy is configured (for diagnostics/logging only). */
export function hasEgressProxyConfigured(): boolean {
  return Boolean(process.env.BROWSER_PROXY_SERVER?.trim());
}
