import Link from 'next/link'
import { ArrowRight, Link2Off } from 'lucide-react'
import { eq } from 'drizzle-orm'
import { getDb, sessions } from '@/lib/db'
import { isShareValid } from '@/lib/share'
import { SharedTranscriptDocument, ShareTopBar } from '@/components/transcript/SharedTranscriptDocument'
import type { Segment } from '@/lib/transcript/store'

export const metadata = { title: 'Shared transcript — LiveTranscript' }

type Summary = { summary?: string } | null

function currentTimestamp(): number {
  return Date.now()
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
  return <SharedTranscriptDocument title={row.title} createdAt={row.createdAt} durationSeconds={row.durationSeconds} segments={segments} summary={summary} />
}
