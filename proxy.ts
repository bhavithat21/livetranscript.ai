import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

// Public: landing, the shared-transcript view (no login), and Clerk's own paths.
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/s/(.*)',
  '/shadow-demo',
  '/pricing',
  '/__clerk/(.*)',
])

const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

// Dev-only preview bypass (Clerk's Turnstile blocks the automated browser).
// HARD-gated to non-production so it can never disable auth in prod.
const previewNoAuth =
  process.env.NODE_ENV !== 'production' && process.env.PREVIEW_NO_AUTH === '1'

// Until Clerk keys are set (or in preview mode), pass everything through so the
// app runs locally. Once configured, protect all non-public routes.
export default clerkConfigured && !previewNoAuth
  ? clerkMiddleware(async (auth, req) => {
      if (!isPublicRoute(req)) {
        await auth.protect()
      }
    })
  : () => NextResponse.next()

export const config = {
  matcher: [
    // Skip Next internals and static files unless in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
    '/__clerk/(.*)',
  ],
}
