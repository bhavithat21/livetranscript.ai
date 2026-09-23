import Link from 'next/link'
import { ArrowLeft, CalendarDays, Clock3, FileText, ListChecks } from 'lucide-react'
import { notFound } from 'next/navigation'
import { getSession } from '../../session-actions'
import { NoSessionContextError } from '@/lib/db/errors'
import { logError } from '@/lib/log'
import { SessionActions } from '@/components/session/SessionActions'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { transcriptText, type Segment } from '@/lib/transcript/store'
import { formatDate, formatDuration } from '@/lib/format'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Transcript — LiveTranscript' }

type Summary = { summary: string; keyPoints?: string[]; actionItems?: string[] } | null

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Not-signed-in / no-DB and a missing row are both a 404; a real query failure
  // (outage) must surface as an error, not a misleading "not found".
  let row: Awaited<ReturnType<typeof getSession>>
  try {
    row = await getSession(id)
  } catch (err) {
    if (err instanceof NoSessionContextError) notFound()
    logError('session/getSession', err)
    throw err
  }
  if (!row) notFound()

  const segments = (row.segments as Segment[]) ?? []
  const summary = row.summary as Summary
  const text = transcriptText(segments)

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-5 sm:px-6 sm:pt-8">
      <nav aria-label="Transcript navigation" className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <HomeMenu />
        <Link href="/dashboard" className="btn-ghost gap-2 text-sm"><ArrowLeft size={15} aria-hidden />All transcripts</Link>
      </nav>

      <header className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-7">
        <p className="mb-3 flex items-center gap-2 text-xs font-medium text-[color:var(--muted)]"><FileText size={14} aria-hidden />Saved transcript</p>
        <SessionActions id={row.id} title={row.title} shared={Boolean(row.shareToken)} transcript={text} />
        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-[color:var(--line)] pt-4 text-xs text-[color:var(--muted)]">
          <span className="inline-flex items-center gap-1.5"><CalendarDays size={14} aria-hidden />{formatDate(row.createdAt)}</span>
          <span className="inline-flex items-center gap-1.5 tabular-nums"><Clock3 size={14} aria-hidden />{formatDuration(row.durationSeconds)}</span>
        </div>
      </header>

      {summary?.summary && (
        <section aria-labelledby="session-summary" className="mt-5 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-7">
          <h2 id="session-summary" className="mb-3 flex items-center gap-2 text-base font-semibold"><ListChecks size={18} className="text-[color:var(--signal)]" aria-hidden />Summary</h2>
          <p className="text-base leading-7 text-ink">{summary.summary}</p>
          {(Boolean(summary.keyPoints?.length) || Boolean(summary.actionItems?.length)) && <div className="mt-6 grid gap-6 border-t border-[color:var(--line)] pt-5 sm:grid-cols-2">
            {summary.keyPoints && summary.keyPoints.length > 0 && <div>
              <h3 className="mb-3 text-sm font-semibold">Key points</h3>
              <ul className="space-y-2.5 text-sm leading-6 text-[color:var(--muted)]">{summary.keyPoints.map((point, index) => <li key={index} className="flex gap-2.5"><span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--signal)]" aria-hidden />{point}</li>)}</ul>
            </div>}
            {summary.actionItems && summary.actionItems.length > 0 && <div>
              <h3 className="mb-3 text-sm font-semibold">Action items</h3>
              <ul className="space-y-2.5 text-sm leading-6 text-[color:var(--muted)]">{summary.actionItems.map((action, index) => <li key={index} className="flex gap-2.5"><span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--signal)]" aria-hidden />{action}</li>)}</ul>
            </div>}
          </div>}
        </section>
      )}

      <section aria-labelledby="session-transcript" className="mt-5 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)]">
        <div className="border-b border-[color:var(--line)] px-5 py-4 sm:px-7"><h2 id="session-transcript" className="text-base font-semibold">Full transcript</h2><p className="mt-1 text-xs text-[color:var(--muted)]">The conversation, in order.</p></div>
        {segments.length ? <TranscriptView segments={segments} readerMode flow /> : <p className="px-5 py-14 text-center text-sm text-[color:var(--muted)]">No transcript text was saved for this session.</p>}
      </section>
    </main>
  )
}
