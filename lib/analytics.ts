import { PostHog } from 'posthog-node'

// Server-side PostHog. Lazy + null-safe: no key => no-op, never breaks a route.
let server: PostHog | null = null

export function posthogServer(): PostHog | null {
  const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  if (!server) {
    server = new PostHog(key, {
      host: process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      flushAt: 1,
      flushInterval: 0,
    })
  }
  return server
}
