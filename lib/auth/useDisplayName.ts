'use client'
import { useUser } from '@clerk/nextjs'
import { createContext, createElement, useContext, type ReactNode } from 'react'

const DisplayNameContext = createContext<string | undefined>(undefined)

function ClerkDisplayNameProvider({ children }: { children: ReactNode }) {
  const { user } = useUser()
  const name = user?.fullName?.trim() || user?.username?.trim() || user?.firstName?.trim() || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || undefined
  return createElement(DisplayNameContext.Provider, { value: name }, children)
}

// Branch components rather than hook calls: preview mode never invokes Clerk
// outside its provider, while configured sessions always call the same hooks.
export function DisplayNameBridge({ clerkConfigured, children }: { clerkConfigured: boolean; children: ReactNode }) {
  return clerkConfigured
    ? createElement(ClerkDisplayNameProvider, null, children)
    : createElement(DisplayNameContext.Provider, { value: undefined }, children)
}

// The signed-in user's display name for labeling their transcript lines + chat.
// Falls back through fullName → username → first name → email local-part.
// Returns undefined when signed out or Clerk isn't configured (preview mode),
// so callers show the neutral "Speaker N" label instead.
export function useDisplayName(): string | undefined {
  return useContext(DisplayNameContext)
}
