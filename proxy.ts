import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
const isPublicRoute = createRouteMatcher(['/', '/api/health', '/sign-in(.*)', '/sign-up(.*)', '/s/(.*)', '/shadow-demo', '/pricing', '/download', '/updates/(.*)', '/__clerk/(.*)'])
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
const previewNoAuth = process.env.NODE_ENV !== 'production' && process.env.PREVIEW_NO_AUTH === '1'
export default clerkConfigured && !previewNoAuth ? clerkMiddleware(async (auth, req) => {
  const isolatedQa = process.env.VERCEL_ENV === 'preview' && req.nextUrl.pathname === '/api/audio-continuity-check'
  if (!isPublicRoute(req) && !isolatedQa) await auth.protect()
}) : () => NextResponse.next()
export const config = {matcher:['/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|dmg|exe|msi|gz|sig)).*)','/(api|trpc)(.*)','/__clerk/(.*)']}
