import Link from 'next/link'
import { ArrowRight, CalendarDays, Clock3, FileText, Link2Off, LockKeyhole, Users } from 'lucide-react'
import { eq } from 'drizzle-orm'
import { getDb, sessions } from '@/lib/db'
import { isShareValid } from '@/lib/share'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { SiteFooter } from '@/components/site/SiteFooter'
import { formatDate, formatDuration } from '@/lib/format'
import type { Segment } from '@/lib/transcript/store'

export const metadata = { title: 'Shared transcript — LiveTranscript' }

type Summary = { summary?: string } | null

function currentTimestamp(): number {
  return Date.now()
}

// Brand bar on the public share view — recipients land here first, so it should
// feel like a real product, with a subtle path to try it.
function ShareTopBar() {
  return (
    <header className="border-b border-[color:var(--line)] bg-[color:var(--reader)]">
      <div className="mx-auto flex min-h-18 max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="inline-flex min-h-11 items-center gap-2.5 text-base font-semibold tracking-tight"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--signal)] text-white"><FileText size={17} aria-hidden /></span>LiveTranscript</Link>
        <Link href="/" className="btn-ghost gap-1.5 text-sm">Explore the app<ArrowRight size={14} aria-hidden /></Link>
      </div>
    </header>
  )
}

function Expired() {
  return (
    <main className="min-h-dvh bg-[color:var(--paper)] text-ink">
      <ShareTopBar />
      <div className="mx-auto max-w-lg px-4 py-16 sm:px-6 sm:py-24">
        <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-7 sm:p-9">
          <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--surface-soft)] text-[color:var(--muted)]"><Link2Off size={22} aria-hidden /></span>
          <h1 className="text-2xl font-semibold tracking-tight">This transcript link is unavailable</h1>
          <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">The link may have expired or been stopped by its owner. Ask them for a new link to read the transcript.</p>
          <Link href="/" className="btn-ghost mt-6 gap-2 text-sm">Go to LiveTranscript<ArrowRight size={15} aria-hidden /></Link>
        </div>
      </div>
    </main>
  )
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = getDb()
  if (!db) return <Expired />

  const [row] = await db.select().from(sessions).where(eq(sessions.shareToken, token)).limit(1)
  if (!row || !isShareValid(row, currentTimestamp())) return <Expired />

  const segments = (row.segments as Segment[]) ?? []
  const summary = row.summary as Summary
  const speakerCount = new Set(segments.map((s) => s.speaker).filter((s) => s != null)).size

  return (
    <main className="min-h-dvh bg-[color:var(--paper)] text-ink">
      <ShareTopBar />
      <article className="mx-auto max-w-5xl px-4 pb-16 pt-8 sm:px-6 sm:pt-12">
        <header className="mb-7">
          <p className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--line)] bg-[color:var(--reader)] px-2.5 py-1.5 text-xs font-medium text-[color:var(--muted)]"><LockKeyhole size={13} aria-hidden />Shared · Read only</p>
          <h1 className="mt-4 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{row.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-[color:var(--muted)]">
            <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden />{formatDate(row.createdAt)}</span>
            <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 size={14} aria-hidden />{formatDuration(row.durationSeconds)}</span>
            {speakerCount > 0 && <span className="inline-flex items-center gap-1.5"><Users size={14} aria-hidden />{speakerCount} speaker{speakerCount === 1 ? '' : 's'}</span>}
          </div>
        </header>

        {summary?.summary && <section className="mb-5 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-7" aria-labelledby="share-summary">
          <h2 id="share-summary" className="mb-3 text-base font-semibold">Summary</h2>
          <p className="text-base leading-7">{summary.summary}</p>
        </section>}

        <section className="overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)]" aria-labelledby="share-transcript">
          <div className="border-b border-[color:var(--line)] px-5 py-4 sm:px-7"><h2 id="share-transcript" className="text-base font-semibold">Full transcript</h2></div>
          {segments.length ? <TranscriptView segments={segments} readerMode flow /> : <p className="px-5 py-14 text-center text-sm text-[color:var(--muted)]">No transcript text was saved for this session.</p>}
        </section>
      </article>
      <SiteFooter />
    </main>
  )
}
