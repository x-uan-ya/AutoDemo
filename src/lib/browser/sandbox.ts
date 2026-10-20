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
 * but compensate with network egress guards (SSRF validation on every request),
 * no persistent storage, blocked service workers, and running the browser as an
 * untrusted, short-lived process. In production, run the browser in an
 * egress-restricted network segment for defense in depth.
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
