import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  // Native modules (Argon2) must stay external — they use Rust binaries
  // that Turbopack can't bundle for the server runtime.
  serverExternalPackages: ["@node-rs/argon2"],
  typescript: {
    // Type safety is enforced separately via `tsc --noEmit` in CI;
    // do not silently ignore build errors.
    ignoreBuildErrors: false,
  },
  // Stabilize typed routes for route contract verification (G01 acceptance).
  typedRoutes: true,
  // Exclude test-only API routes from the production standalone output trace.
  // The route itself is still compiled (Next.js doesn't support per-route
  // exclusion cleanly), but the standalone server won't include it in its
  // file trace, making it harder to accidentally deploy. The runtime guard
  // in the route handler is the primary defense.
  outputFileTracingExcludes: {
    "*": ["./src/app/api/test/**/*"],
  },
  // Security headers applied globally; middleware layers additional per-request controls.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
