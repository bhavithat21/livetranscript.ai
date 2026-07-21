'use client'
import { useUser } from '@clerk/nextjs'

// The signed-in user's display name for labeling their transcript lines + chat.
// Falls back through fullName → username → first name → email local-part.
// Returns undefined when signed out or Clerk isn't configured (preview mode),
// so callers show the neutral "Speaker N" label instead.
export function useDisplayName(): string | undefined {
  let user: ReturnType<typeof useUser>['user'] | undefined
  try {
    user = useUser().user
  } catch {
    // No ClerkProvider mounted (Clerk not configured) — hooks throw; degrade quietly.
    return undefined
  }
  if (!user) return undefined
  return (
    user.fullName?.trim() ||
    user.username?.trim() ||
    user.firstName?.trim() ||
    user.primaryEmailAddress?.emailAddress?.split('@')[0] ||
    undefined
  )
}
