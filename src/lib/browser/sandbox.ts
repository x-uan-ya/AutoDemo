/**
 * Shared Playwright sandboxing configuration.
 *
 * The website being explored is UNTRUSTED. The browser must never give page
 * content access to the server filesystem, env vars, secrets, internal APIs, or
 * Node.js. Playwright already isolates the page from Node (no Node globals in
 * the page; `page.evaluate` runs a serialized function we control, never
 * website-supplied code). These launch args further reduce the browser's
 * capability surface and disable features we never need.
 *
 * Note on `--no-sandbox`: Chromium's OS sandbox requires privileges unavailable
 * in many container/CI environments. We keep `--no-sandbox` for compatibility
 * and add application-level defense in depth (per-request SSRF validation, no
 * persistent storage, blocked service workers, short-lived untrusted process).
 * These reduce but do NOT eliminate network-pivot risk (e.g. DNS rebinding).
 * Production MUST run the browser worker in a network-isolated environment with
 * enforced egress controls — see SECURITY.md ("Browser Network Isolation") and
 * DEPLOYMENT.md. The network layer, not this file, is the real boundary.
 */
export const HARDENED_LAUNCH_ARGS: string[] = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-extensions",
  "--disable-plugins",
  "--disable-background-networking",
  "--disable-sync",
  "--disable-default-apps",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-client-side-phishing-detection",
  "--disable-component-update",
  "--mute-audio",
];
