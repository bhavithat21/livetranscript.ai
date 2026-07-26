import Link from 'next/link'
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
    <main className="mx-auto max-w-3xl px-4 pb-24 pt-10 sm:px-6">
      <div className="flex items-center gap-3">
        <HomeMenu />
        <Link href="/dashboard" className="text-sm text-black/50 transition-colors hover:text-ink">
          ← Library
        </Link>
      </div>

      <div className="glass rise-in mt-4 rounded-2xl p-6">
        <SessionActions id={row.id} title={row.title} shared={Boolean(row.shareToken)} transcript={text} />
        <div className="mt-3 flex items-center gap-3 text-xs text-black/40">
          <span>{formatDate(row.createdAt)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDuration(row.durationSeconds)}</span>
        </div>
      </div>

      {summary?.summary && (
        <section className="reader-surface rise-in mt-4 rounded-2xl p-6" style={{ animationDelay: '80ms' }}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/40">Summary</h2>
          {/* Serif standfirst lead — treats the summary as editorial, not a form field. */}
          <p className="font-[family-name:var(--font-serif)] text-xl leading-relaxed text-ink">
            {summary.summary}
          </p>
          {summary.keyPoints && summary.keyPoints.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-black/40">Key points</h3>
              <ul className="space-y-1 text-black/80">
                {summary.keyPoints.map((k, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-[color:var(--signal)]">•</span>
                    {k}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {summary.actionItems && summary.actionItems.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-black/40">Action items</h3>
              <ul className="space-y-1.5 text-black/80">
                {summary.actionItems.map((a, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="mt-0.5 inline-block h-4 w-4 shrink-0 rounded border border-black/25" aria-hidden />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="mt-4">
        <h2 className="mb-1.5 px-1 text-sm font-semibold uppercase tracking-wide text-black/40">
          Transcript
        </h2>
        {/* Solid warm reading surface (not glass) — max contrast for the payload. */}
        <div className="reader-surface rise-in rounded-2xl" style={{ animationDelay: '160ms' }}>
          <TranscriptView segments={segments} theme="light" readerMode flow />
        </div>
      </section>
    </main>
  )
}
