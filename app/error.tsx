'use client'
import { useEffect } from 'react'
import { logError } from '@/lib/log'

// App Router error boundary: any uncaught render/effect error in a route segment
// lands here instead of a white screen. We log it and offer a one-tap recovery.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    logError('app/error-boundary', error, { digest: error.digest })
  }, [error])

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="font-[family-name:var(--font-serif)] text-3xl">Something went wrong</h1>
      <p className="mt-3 text-black/60">
        The page hit an unexpected error. Your data is safe — try again, or head back to your library.
      </p>
      <div className="mt-6 flex gap-3">
        <button onClick={reset} className="btn-signal px-6 py-3">
          Try again
        </button>
        <a href="/dashboard" className="btn-ghost px-5 py-3">
          Go to library
        </a>
      </div>
    </main>
  )
}
