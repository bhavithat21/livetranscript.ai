import Link from 'next/link'
import { Wordmark } from '@/components/nav/Wordmark'

// Shared footer for the public surfaces (landing + shared-transcript view) — the
// cheapest "this is a real product" trust signal, and it closes the share-view
// growth loop by pointing recipients back to the product.
export function SiteFooter() {
  return (
    <footer className="border-t border-black/10 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
        <div>
          <Link href="/">
            <Wordmark className="text-lg" />
          </Link>
          <p className="mt-1 max-w-xs text-sm text-black/45">
            Real-time AI transcription — every word, the moment it&rsquo;s said.
          </p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-black/55">
          <Link href="/record" className="hover:text-ink">Start transcribing</Link>
          <Link href="/room/new" className="hover:text-ink">Open a meeting</Link>
          <Link href="/download" className="hover:text-ink">Desktop app</Link>
          <Link href="/pricing" className="hover:text-ink">Pricing</Link>
          <Link href="/sign-up" className="hover:text-ink">Sign up</Link>
        </nav>
      </div>
      <p className="mx-auto mt-6 max-w-5xl text-xs text-black/30">© 2026 LiveTranscript</p>
    </footer>
  )
}
