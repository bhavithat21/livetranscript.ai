'use client'
import { useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import posthog from 'posthog-js'

// Ties PostHog events to the signed-in user so metrics are per-user, not just
// per-browser: identify() on sign-in, reset() on sign-out. Without this every
// session is an anonymous stranger and you can't see patterns across visits.
//
// Rendered ONLY when Clerk is configured (see Providers), so useUser() always has
// a mounted ClerkProvider — no try/catch, no conditional hook (Rules of Hooks).
// `ready` is the parent's reactive "PostHog initialized" flag: because child
// effects run before parent effects, identify() would otherwise fire before
// posthog.init() and silently no-op. Gating on reactive state (not the
// non-reactive posthog.__loaded) guarantees the effect re-runs once init lands.
export function AnalyticsIdentity({ ready }: { ready: boolean }) {
  const { isLoaded, isSignedIn, user } = useUser()

  useEffect(() => {
    if (!ready || !isLoaded) return
    if (isSignedIn && user) {
      // distinctId = Clerk user id, matching the server-side capture() calls
      // (record/actions.ts, session-actions.ts) so client + server events merge.
      posthog.identify(user.id, {
        email: user.primaryEmailAddress?.emailAddress,
        name: user.fullName ?? undefined,
        created_at: user.createdAt ?? undefined,
      })
    } else {
      // Signed out: drop the identity so the next user isn't merged into this one.
      posthog.reset()
    }
  }, [ready, isLoaded, isSignedIn, user])

  return null
}
