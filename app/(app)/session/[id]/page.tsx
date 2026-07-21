import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '../../session-actions'
import { SessionActions } from '@/components/session/SessionActions'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { transcriptText, type Segment } from '@/lib/transcript/store'
import { formatDate, formatDuration } from '@/lib/format'

export const dynamic = 'force-dynamic'

type Summary = { summary: string; keyPoints?: string[]; actionItems?: string[] } | null

export default async function SessionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const row = await getSession(id).catch(() => null)
  if (!row) notFound()

  const segments = (row.segments as Segment[]) ?? []
  const summary = row.summary as Summary
  const text = transcriptText(segments)

  return (
    <main className="mx-auto max-w-3xl px-6 pb-24 pt-10">
      <Link href="/dashboard" className="text-sm text-black/50 hover:text-ink">
        ← Library
      </Link>

      <div className="glass mt-4 rounded-2xl p-6">
        <SessionActions id={row.id} title={row.title} shared={Boolean(row.shareToken)} transcript={text} />
        <div className="mt-3 flex items-center gap-3 text-xs text-black/40">
          <span>{formatDate(row.createdAt)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDuration(row.durationSeconds)}</span>
        </div>
      </div>

      {summary?.summary && (
        <section className="glass mt-4 rounded-2xl p-6">
          <h2 className="mb-2 font-[family-name:var(--font-serif)] text-xl">Summary</h2>
          <p className="leading-relaxed text-black/80">{summary.summary}</p>
          {summary.keyPoints && summary.keyPoints.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-black/40">
                Key points
              </h3>
              <ul className="list-disc pl-5 text-black/80">
                {summary.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.actionItems && summary.actionItems.length > 0 && (
            <div className="mt-4">
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-black/40">
                Action items
              </h3>
              <ul className="list-disc pl-5 text-black/80">
                {summary.actionItems.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="mt-4">
        <h2 className="mb-1 px-1 text-sm font-semibold uppercase tracking-wide text-black/40">
          Transcript
        </h2>
        <div className="glass rounded-2xl">
          <TranscriptView segments={segments} theme="light" readerMode />
        </div>
      </section>
    </main>
  )
}
