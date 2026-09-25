import Link from 'next/link'
import { Wordmark } from '@/components/nav/Wordmark'
import { ArrowRight, CalendarDays, Clock3, LockKeyhole, Users } from 'lucide-react'
import { TranscriptReader } from './TranscriptReader'
import { SiteFooter } from '@/components/site/SiteFooter'
import { formatDate, formatDuration } from '@/lib/format'
import type { Segment } from '@/lib/transcript/store'

// Brand bar on the public share view — recipients land here first, so it should
// feel like a real product, with a subtle path to try it.
export function ShareTopBar() {
  return (
    <header className="border-b border-[color:var(--line)] bg-[color:var(--reader)]">
      <div className="mx-auto flex min-h-18 max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 text-base font-semibold tracking-tight"><Wordmark /></Link>
        <Link href="/" className="btn-ghost gap-1.5 text-sm">Explore the app<ArrowRight size={14} aria-hidden /></Link>
      </div>
    </header>
  )
}


/** Shared presentation only. Authorization and expiration remain in the server route. */
export function SharedTranscriptDocument({ title, createdAt, durationSeconds, segments, summary }: {
  title: string; createdAt: Date | string; durationSeconds: number; segments: Segment[]; summary: { summary?: string } | null
}) {
  const speakerCount = new Set(segments.map(segment => segment.speaker).filter(speaker => speaker != null)).size
  return (
    <main className="min-h-dvh bg-[color:var(--paper)] text-ink">
      <ShareTopBar />
      <article className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <header className="mb-7">
          <p className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--line)] bg-[color:var(--reader)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)]"><LockKeyhole size={13} aria-hidden />Shared · Read only</p>
          <h1 className="mt-4 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{title === 'Untitled session' ? 'Session transcript' : title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-[color:var(--muted)]">
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden />{formatDate(createdAt)}</span>
            <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 size={14} aria-hidden />{formatDuration(durationSeconds)}</span>
            {speakerCount > 0 && <span className="inline-flex items-center gap-1.5"><Users size={14} aria-hidden />{speakerCount} speaker label{speakerCount === 1 ? '' : 's'}</span>}
          </div>
        </header>

        {summary?.summary && <section className="mb-5 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-7" aria-labelledby="share-summary">
          <h2 id="share-summary" className="mb-3 text-base font-semibold">AI-generated summary</h2>
          <p className="text-base leading-7">{summary.summary}</p>
        </section>}

        <section className="overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)]" aria-labelledby="share-transcript">
          <div className="border-b border-[color:var(--line)] px-5 py-4 sm:px-7"><h2 id="share-transcript" className="text-base font-semibold">Full transcript</h2></div>
          {segments.length ? <TranscriptReader segments={segments} /> : <p className="px-5 py-14 text-center text-sm text-[color:var(--muted)]">No transcript text was saved for this session.</p>}
        </section>
      </article>
      <SiteFooter />
    </main>
  )
}
