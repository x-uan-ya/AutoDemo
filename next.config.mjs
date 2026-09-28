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
};

export default nextConfig;
