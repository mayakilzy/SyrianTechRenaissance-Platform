import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Build-time flag: expose Google provider status to client bundle without
// pulling server-only modules (argon2, prisma) into the client.
const googleEnabled = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  // Native modules (Argon2) must stay external — they use Rust binaries
  // that Turbopack can't bundle for the server runtime.
  serverExternalPackages: ["@node-rs/argon2"],
  typescript: {
    ignoreBuildErrors: false,
  },
  typedRoutes: true,
  // Expose the Google-enabled flag to the client bundle at build time.
  env: {
    NEXT_PUBLIC_GOOGLE_ENABLED: googleEnabled ? "true" : "false",
  },
  // Security headers applied globally; proxy layers additional per-request controls.
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
