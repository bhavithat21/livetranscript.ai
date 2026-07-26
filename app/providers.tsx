'use client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect, useState } from 'react'
import { logError } from '@/lib/log'
import { AnalyticsIdentity } from '@/components/AnalyticsIdentity'

// NEXT_PUBLIC_* is inlined at build time, so this is safe on the client and
// matches the flag layout.tsx uses to decide whether to mount ClerkProvider.
const clerkConfigured = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)

export function Providers({ children }: { children: React.ReactNode }) {
  // Reactive "PostHog initialized" flag. AnalyticsIdentity gates identify() on
  // this: child effects run before parent effects, so without a reactive signal
  // identify() would fire before init() and silently no-op.
  const [analyticsReady, setAnalyticsReady] = useState(false)

  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (key && !posthog.__loaded) {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        capture_pageview: true,
        // Autocapture ON: clicks/inputs/pageviews recorded automatically so we can
        // see behavioral patterns without hand-instrumenting every control.
        // ponytail: broad-strokes coverage; add targeted posthog.capture() calls
        // for funnel steps autocapture can't infer (e.g. "recording_started").
        autocapture: true,
        // PRIVACY: this app renders users' private transcripts. Autocapture would
        // otherwise ship visible DOM text (i.e. transcript content) to PostHog on
        // every click. Mask all text + attributes so only element structure is
        // captured, never the words. Do NOT set these false.
        mask_all_text: true,
        mask_all_element_attributes: true,
      })
    }
    // Mark ready whether or not PostHog loaded — if there's no key, identify()
    // has nothing to attach to and its own posthog.__loaded guard would no-op
    // anyway; flipping ready lets the effect settle instead of hanging.
    if (posthog.__loaded) setAnalyticsReady(true)
  }, [])

  // Safety net: log any stray promise rejection / global error instead of letting
  // it surface as an uncaught console error. Non-breaking by definition — the app
  // keeps running; we just record what slipped through (e.g. a realtime hiccup).
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => logError('unhandledrejection', e.reason)
    const onError = (e: ErrorEvent) => logError('window.error', e.error ?? e.message)
    window.addEventListener('unhandledrejection', onRejection)
    window.addEventListener('error', onError)
    return () => {
      window.removeEventListener('unhandledrejection', onRejection)
      window.removeEventListener('error', onError)
    }
  }, [])

  return (
    <PostHogProvider client={posthog}>
      {/* Only mount when Clerk is configured — AnalyticsIdentity calls useUser()
          unconditionally, so it must live inside a guaranteed ClerkProvider. */}
      {clerkConfigured && <AnalyticsIdentity ready={analyticsReady} />}
      {children}
    </PostHogProvider>
  )
}
