// One place to record an error. NEVER throws — logging must not create a second
// failure on top of the one we're reporting. Isomorphic: console on both sides,
// plus a best-effort PostHog event server-side. The PostHog (posthog-node)
// import is DYNAMIC and gated on the server branch so it never lands in the
// client bundle (it uses node:async_hooks and would break the build otherwise).
export function logError(scope: string, err: unknown, meta?: Record<string, unknown>): void {
  try {
    const message = err instanceof Error ? err.message : String(err)
    const stack = err instanceof Error ? err.stack : undefined
    console.error(`[${scope}] ${message}`, meta ?? '')

    if (typeof window === 'undefined') {
      // Server only. Dynamic import keeps posthog-node out of client chunks.
      import('./analytics')
        .then(({ posthogServer }) => {
          posthogServer()?.capture({
            distinctId: 'system',
            event: 'app_error',
            properties: { scope, message, stack, ...meta },
          })
        })
        .catch(() => {})
    }
  } catch {
    /* logging itself failed — swallow; never let the reporter break the caller */
  }
}
