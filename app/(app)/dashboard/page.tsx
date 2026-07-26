import Link from 'next/link'
import { listSessions, type SessionSummaryRow } from '../session-actions'
import { LibraryView } from '@/components/session/LibraryView'
import { NoSessionContextError } from '@/lib/db/errors'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  let sessions: SessionSummaryRow[]
  try {
    sessions = await listSessions()
  } catch (err) {
    // Only the "no signed-in user / no DB configured" case is an empty library.
    // A genuine query failure (outage) must NOT masquerade as "no transcripts" —
    // let it surface as an error boundary so we don't hide data loss.
    if (!(err instanceof NoSessionContextError)) {
      logError('dashboard/listSessions', err)
      throw err
    }
    sessions = []
  }

  // At-a-glance stats, derived from the rows already in memory (no extra query).
  const totalSeconds = sessions.reduce((n, s) => n + (s.durationSeconds ?? 0), 0)
  const hours = (totalSeconds / 3600).toFixed(totalSeconds >= 36000 ? 0 : 1)
  const sharedCount = sessions.filter((s) => s.shareToken).length
  const now = Date.now()

  return (
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-10">
      {/* Editorial masthead + stat band. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium uppercase tracking-widest text-[color:var(--signal)]">Library</p>
          <h1 className="mt-1 break-words font-[family-name:var(--font-serif)] text-3xl tracking-[-0.02em] sm:text-5xl">
            Your transcripts
          </h1>
        </div>
        <Link href="/record" className="btn-signal">
          New transcript
        </Link>
      </div>

      {sessions.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <dl className="mt-6 flex flex-wrap gap-8 border-y border-black/10 py-4">
            <Stat value={String(sessions.length)} label="sessions" />
            <Stat value={hours} label="hours transcribed" />
            <Stat value={String(sharedCount)} label="shared" />
          </dl>
          <LibraryView sessions={sessions} now={now} />
        </>
      )}
    </main>
  )
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-[family-name:var(--font-serif)] text-3xl tabular-nums leading-none">{value}</div>
      <dt className="mt-1 text-xs uppercase tracking-wide text-black/40">{label}</dt>
    </div>
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
