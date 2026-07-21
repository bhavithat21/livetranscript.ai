import Link from 'next/link'
import { listSessions, type SessionSummaryRow } from '../session-actions'
import { SessionCard } from '@/components/session/SessionCard'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  let sessions: SessionSummaryRow[]
  try {
    sessions = await listSessions()
  } catch {
    // Not signed in or no DB — middleware normally guards this, so treat as empty.
    sessions = []
  }

  return (
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-serif)] text-4xl tracking-[-0.01em]">
            Your transcripts
          </h1>
          <p className="mt-1 text-black/50">
            {sessions.length
              ? `${sessions.length} saved session${sessions.length === 1 ? '' : 's'}`
              : 'Everything you record shows up here.'}
          </p>
        </div>
        <Link href="/record" className="btn-signal">
          New transcript
        </Link>
      </div>

      {sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} session={s} />
          ))}
        </div>
      )}
    </main>
  )
}

function EmptyState() {
  return (
    <div className="glass mt-8 flex flex-col items-center rounded-3xl px-6 py-20 text-center">
      <div className="font-[family-name:var(--font-serif)] text-2xl">No transcripts yet</div>
      <p className="mt-2 max-w-sm text-black/55">
        Start a live transcription or open a meeting — your saved sessions will collect here, ready
        to re-read, share, or export.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/record" className="btn-signal">
          Start transcribing
        </Link>
        <Link href="/room/new" className="btn-ghost px-5 py-2.5">
          Open a meeting
        </Link>
      </div>
    </div>
  )
}
