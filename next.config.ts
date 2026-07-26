import type { NextConfig } from "next";

// Security response headers applied to every route. These are the subset that is
// safe to enforce without breaking Clerk auth, Ably realtime, PostHog, or the
// Deepgram/AssemblyAI websockets — none of which we can browser-verify here.
//
// Deliberately NOT enforcing a script-src/connect-src allowlist yet: getting a
// third-party origin wrong silently breaks login or realtime in production. The
// CSP below only carries directives that can't break those integrations
// (object-src, base-uri, frame-ancestors — none constrain scripts, XHR/WS, or
// the Clerk iframes we embed). worker-src blob: is required by the Pyodide/JS
// sandbox workers.
// ponytail: full script-src/connect-src CSP is a follow-up — add once the exact
// Clerk/Ably/PostHog/ASR origins are verified against a staging deploy.
const CSP = [
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
  "worker-src 'self' blob:",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  // Preserve the capabilities the app actually uses (mic + screen capture for
  // transcription) for same-origin; deny the rest.
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()',
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig;
