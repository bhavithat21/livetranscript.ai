// Record a USAGE metric (not a limit). AI is intentionally unlimited; this only
// gives visibility into who uses what, how much — so usage can be measured without
// being capped. Mirrors logError: server-only, dynamic import so posthog-node never
// lands in the client bundle, and NEVER throws (metrics must not break a route).
//
// Emits a PostHog `copilot_usage` event keyed by the real user id, with the route
// and a few cheap dimensions (mode, model/vendor, language). Query it in PostHog by
// distinctId for per-user usage, or aggregate by `route`/`model` for cost/volume.
export function recordUsage(
  route: string,
  userId: string,
  props?: Record<string, unknown>,
): void {
  try {
    if (typeof window !== 'undefined') return // server-only
    import('./analytics')
      .then(({ posthogServer }) => {
        posthogServer()?.capture({
          distinctId: userId,
          event: 'copilot_usage',
          properties: { route, ...props },
        })
      })
      .catch(() => {})
  } catch {
    /* metrics must never break the caller */
  }
}
