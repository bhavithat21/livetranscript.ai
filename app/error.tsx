'use client'
import { useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw, TriangleAlert } from 'lucide-react'
import { logError } from '@/lib/log'

// App Router error boundary: any uncaught render/effect error in a route segment
// lands here instead of a white screen. We log it and offer a one-tap recovery.
export default function Error({
  error,
  reset,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  reset: () => void
  unstable_retry?: () => void
}) {
  useEffect(() => {
    logError('app/error-boundary', error, { digest: error.digest })
  }, [error])

  return (
    <main className="mx-auto flex min-h-[70dvh] max-w-lg items-center px-4 py-16 sm:px-6">
      <title>Page unavailable — LiveTranscript</title>
      <div className="w-full rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-7 sm:p-9">
        <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--surface-soft)] text-[color:var(--muted)]"><TriangleAlert size={23} aria-hidden /></span>
        <h1 className="text-2xl font-semibold tracking-tight">This page couldn’t load</h1>
        <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">An unexpected error interrupted this page. Try loading it again, or return to your transcripts.</p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={unstable_retry ?? reset} className="btn-signal gap-2 text-sm"><RefreshCw size={15} aria-hidden />Try again</button>
          <Link href="/dashboard" className="btn-ghost gap-2 text-sm"><ArrowLeft size={15} aria-hidden />Transcripts</Link>
        </div>
      </div>
    </main>
  )
}
