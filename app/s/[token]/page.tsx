import Link from 'next/link'
import { eq } from 'drizzle-orm'
import { getDb, sessions } from '@/lib/db'
import { isShareValid } from '@/lib/share'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { SiteFooter } from '@/components/site/SiteFooter'
import { formatDate, formatDuration } from '@/lib/format'
import type { Segment } from '@/lib/transcript/store'

type Summary = { summary?: string } | null

// Brand bar on the public share view — recipients land here first, so it should
// feel like a real product, with a subtle path to try it.
function ShareTopBar() {
  return (
    <header className="flex items-center justify-between px-6 py-4">
      <Link href="/" className="font-[family-name:var(--font-serif)] text-lg font-semibold">
        Live<span className="text-[color:var(--signal)]">Transcript</span>
      </Link>
      <Link href="/" className="btn-signal text-sm">
        Try it free
      </Link>
    </header>
  )
}

function Expired() {
  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      <ShareTopBar />
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-[family-name:var(--font-serif)] text-3xl">This link has expired</h1>
        <p className="mt-3 text-black/60">
          Shared transcripts are available for a limited time. Ask the owner to send a fresh link,
          or make your own.
        </p>
        <Link href="/" className="btn-signal mt-6 inline-block px-6 py-3">
          Start transcribing
        </Link>
      </div>
    </main>
  )
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const db = getDb()
  if (!db) return <Expired />

  const [row] = await db.select().from(sessions).where(eq(sessions.shareToken, token)).limit(1)
  if (!row || !isShareValid(row, Date.now())) return <Expired />

  const segments = (row.segments as Segment[]) ?? []
  const summary = row.summary as Summary
  const speakerCount = new Set(segments.map((s) => s.speaker).filter((s) => s != null)).size

  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      <ShareTopBar />

      <article className="mx-auto max-w-3xl px-6 pb-16 pt-6">
        {/* Document masthead — turns an anonymous text dump into a forwardable briefing. */}
        <p className="text-sm font-medium uppercase tracking-widest text-[color:var(--signal)]">
          Shared transcript
        </p>
        <h1 className="mt-2 font-[family-name:var(--font-serif)] text-4xl leading-tight tracking-[-0.01em]">
          {row.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-black/45">
          <span>{formatDate(row.createdAt)}</span>
          <span aria-hidden>·</span>
          <span className="tabular-nums">{formatDuration(row.durationSeconds)}</span>
          {speakerCount > 0 && (
            <>
              <span aria-hidden>·</span>
              <span>{speakerCount} speaker{speakerCount === 1 ? '' : 's'}</span>
            </>
          )}
          <span className="ml-1 rounded-full bg-black/5 px-2 py-0.5 text-xs">read-only</span>
        </div>

        {summary?.summary && (
          <div className="glass mt-6 rounded-2xl p-5">
            <div className="text-xs font-semibold uppercase tracking-wide text-black/40">TL;DR</div>
            <p className="mt-1.5 font-[family-name:var(--font-serif)] text-lg leading-relaxed">
              {summary.summary}
            </p>
          </div>
        )}

        <div className="reader-surface mt-6 rounded-2xl">
          <TranscriptView segments={segments} theme="light" readerMode flow />
        </div>
      </article>

      <SiteFooter />
    </main>
  )
}
