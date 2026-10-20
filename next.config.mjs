/**
 * Content-Security-Policy.
 *
 * Rationale / required exceptions:
 *  - script-src includes 'unsafe-inline' because Next.js injects small inline
 *    bootstrap scripts; removing it needs nonce wiring (future work). It does
 *    NOT include 'unsafe-eval'.
 *  - img-src and media-src allow data: and blob: because generated screenshots
 *    are embedded as data: URLs and video/audio are served from same-origin and
 *    (in dev) blob previews.
 *  - connect-src 'self' — the app's own API only.
 *  - frame-ancestors 'none' — the app must not be framed (clickjacking).
 *  - object-src 'none' — no plugins.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
  // HSTS only affects HTTPS responses; harmless over HTTP in local dev.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Remotion's Node-only render/bundle packages (and Playwright) must not be
  // bundled by Next; they are required at runtime on the Node.js runtime.
  // Keeping them external avoids resolving their native/optional deps at build.
  serverExternalPackages: [
    "@remotion/bundler",
    "@remotion/renderer",
    "@remotion/cli",
    "remotion",
    "playwright",
  ],
  async headers() {
    return [
      {
        // Apply security headers to every route.
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
