'use client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'
import { logError } from '@/lib/log'

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
    if (key && !posthog.__loaded) {
      posthog.init(key, {
        api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
        capture_pageview: true,
        autocapture: false, // explicit events only; autocapture is noise for this app
      })
    }
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

  return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
