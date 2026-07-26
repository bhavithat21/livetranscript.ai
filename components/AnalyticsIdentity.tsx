'use client'
import { useEffect } from 'react'
import { useUser } from '@clerk/nextjs'
import posthog from 'posthog-js'

// Ties PostHog events to the signed-in user so metrics are per-user, not just
// per-browser: identify() on sign-in, reset() on sign-out. Without this every
// session is an anonymous stranger and you can't see patterns across a user's
// visits. Degrades quietly when Clerk isn't configured (preview/browser build) —
// useUser throws with no ClerkProvider, so we guard it. Renders nothing.
function useClerkUserSafe() {
  try {
    return useUser()
  } catch {
    // No ClerkProvider mounted — analytics stays anonymous, app unaffected.
    return { isLoaded: false, isSignedIn: false, user: null } as const
  }
}

export function AnalyticsIdentity() {
  const { isLoaded, isSignedIn, user } = useClerkUserSafe()

  useEffect(() => {
    if (!isLoaded || !posthog.__loaded) return
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
  }, [isLoaded, isSignedIn, user])

  return null
}
