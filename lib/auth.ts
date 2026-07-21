import { auth } from '@clerk/nextjs/server'

// Dev-only preview bypass so gated screens can be rendered/screenshotted without
// a real Clerk login (Clerk's Turnstile blocks the automated browser). HARD-gated:
// only active when NOT production AND PREVIEW_NO_AUTH=1. Never trips in prod.
export const PREVIEW_NO_AUTH =
  process.env.NODE_ENV !== 'production' && process.env.PREVIEW_NO_AUTH === '1'

export const PREVIEW_USER_ID = 'preview_user'

// The owner id for the current request: a fixed stub in preview mode, else Clerk's.
export async function currentUserId(): Promise<string | null> {
  if (PREVIEW_NO_AUTH) return PREVIEW_USER_ID
  const { userId } = await auth()
  return userId
}
