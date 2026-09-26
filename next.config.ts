import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  // Type errors block the build. This was `ignoreBuildErrors: true`, so the
  // production build compiled regardless of what tsc said -- and with the lint
  // ruleset also disabled, every "Code Quality" line on the go-live checklist
  // rested on gates that could not fail.
  //
  // Next 16 no longer runs ESLint during the build and removed the `eslint`
  // config key, so linting is a separate gate: `bun run lint`, which must be
  // wired into CI alongside this.
  typescript: {
    ignoreBuildErrors: false,
  },

  reactStrictMode: false,
  // Browser source maps are generated only to be uploaded to Sentry, and are
  // deleted from the build output afterwards (see `sourcemaps` below). They
  // must never be served: a public .map reconstructs the whole client source.
  productionBrowserSourceMaps: process.env.SENTRY_AUTH_TOKEN ? true : false,
  // Headers for PWA + security (per §15 + §13)
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [
          { key: 'Content-Type', value: 'application/manifest+json' },
        ],
      },
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Per §6 rule 5 — strict CSP + HSTS
          // frame-ancestors allows space-z.ai preview gateway (needed for live preview)
          // Note: script-src includes 'unsafe-inline' because Next.js 16 Turbopack
          // injects inline scripts for client hydration. In production with a nonce-
          // based CSP, this should be replaced with per-request nonces.
          { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'self' https://*.space-z.ai; base-uri 'self'; form-action 'self'" },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  // Only relevant when SENTRY_AUTH_TOKEN is set
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  // Explicit, not left to the default. @sentry/nextjs turns deletion on by
  // itself only when it also turns source maps on; because
  // productionBrowserSourceMaps is set above, it did neither, deletion
  // defaulted to false, and every .map was published under /_next/static.
  // scripts/remove-public-sourcemaps.mjs backs this up after the build, for a
  // build where the upload failed and nothing was deleted.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  // autoInstrumentServerFunctions was set here. It is a webpack-only option,
  // deprecated in @sentry/nextjs 10 and not supported with Turbopack -- which
  // this project builds with -- so it did nothing. Server errors are captured
  // through onRequestError in instrumentation.ts instead.
});
