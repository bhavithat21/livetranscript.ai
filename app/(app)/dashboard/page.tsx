import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowUpRight, AudioLines, Clock3, FileText, Link2, Plus } from 'lucide-react'
import { listSessions, type SessionSummaryRow } from '../session-actions'
import { LibraryView } from '@/components/session/LibraryView'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { NoSessionContextError } from '@/lib/db/errors'
import { logError } from '@/lib/log'
import { formatDuration } from '@/lib/format'
import { isShareValid } from '@/lib/share'

export const metadata: Metadata = { title: 'Transcripts — LiveTranscript', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

function currentTimestamp(): number {
  return Date.now()
}

export default async function DashboardPage() {
  let sessions: SessionSummaryRow[]
  let unavailable: 'sign-in' | 'storage' | null = null
  try {
    sessions = await listSessions()
  } catch (err) {
    // A query outage must reach the error boundary, never a false empty library.
    if (!(err instanceof NoSessionContextError)) {
      logError('dashboard/listSessions', err)
      throw err
    }
    unavailable = err.message === 'Not authenticated' ? 'sign-in' : 'storage'
    sessions = []
  }

  const totalSeconds = sessions.reduce((total, session) => total + (session.durationSeconds ?? 0), 0)
  const now = currentTimestamp()
  const sharedCount = sessions.filter((session) => isShareValid(session, now)).length

  return (
    <WorkspaceShell active="transcripts">
      <main className="mx-auto w-full max-w-[1200px] px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-medium text-[color:var(--muted)]"><FileText size={14} aria-hidden /> Your conversation library</p>
            <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Transcripts</h1>
            <p className="mt-2 text-sm text-[color:var(--muted)]">Keep the details. Return to the conversation when you need it.</p>
          </div>
          <Link href="/record" className="btn-signal gap-2 text-sm"><Plus size={16} aria-hidden /> New transcript</Link>
        </header>

        {unavailable ? <div role="status" className="mt-7 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-6">
          <h2 className="text-lg font-semibold">{unavailable === 'sign-in' ? 'Sign in to open your transcripts' : 'Transcript storage is unavailable'}</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[color:var(--muted)]">{unavailable === 'sign-in' ? 'Your saved sessions are linked to your account.' : 'Saved transcripts need a connected database in this environment. Your existing transcripts have not been changed.'}</p>
          {unavailable === 'sign-in' && <Link href="/sign-in" className="btn-signal mt-5 text-sm">Sign in</Link>}
        </div> : <>
          <dl className="mt-7 grid gap-3 sm:grid-cols-3">
            <Stat value={String(sessions.length)} label="Recent transcripts" detail="Saved conversations" icon={FileText} />
            <Stat value={formatDuration(totalSeconds)} label="Time transcribed" detail="Across these sessions" icon={Clock3} />
            <Stat value={String(sharedCount)} label="Active share links" detail="Access you can revoke" icon={Link2} />
          </dl>
          {sessions.length === 0 ? <EmptyState /> : <LibraryView sessions={sessions} now={now} />}
        </>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[color:var(--line)] px-4 py-3 text-xs text-[color:var(--muted)]">
          <p>Looking for live interview history or assistant test results?</p>
          <Link href="/interview#feedback" className="inline-flex min-h-9 items-center gap-1.5 font-medium text-[color:var(--signal)] hover:underline">Open interview feedback <ArrowUpRight size={14} aria-hidden /></Link>
        </div>
      </main>
    </WorkspaceShell>
  )
}

function Stat({ value, label, detail, icon: Icon }: { value: string; label: string; detail: string; icon: typeof FileText }) {
  return <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-4 sm:p-5">
    <dt className="flex items-center justify-between gap-3 text-xs font-medium text-[color:var(--muted)]">{label}<Icon size={16} aria-hidden /></dt>
    <dd className="mt-3"><span className="block text-2xl font-semibold tabular-nums tracking-tight">{value}</span><span className="mt-1 block text-xs text-[color:var(--muted)]">{detail}</span></dd>
  </div>
}

function EmptyState() {
  return <section className="mt-6 flex min-h-80 flex-col items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] px-6 py-12 text-center" aria-labelledby="empty-transcripts-heading">
    <span className="flex h-14 w-14 items-center justify-center rounded-xl bg-[color:var(--accent-soft)] text-[color:var(--signal)]"><AudioLines size={27} aria-hidden /></span>
    <h2 id="empty-transcripts-heading" className="mt-5 text-lg font-semibold">Your next conversation starts here</h2>
    <p className="mt-2 max-w-md text-sm leading-relaxed text-[color:var(--muted)]">Start a transcript or open a meeting. When you save a session, its transcript and summary will appear here.</p>
    <div className="mt-6 flex flex-wrap justify-center gap-3"><Link href="/record" className="btn-signal gap-2 text-sm"><Plus size={15} aria-hidden /> Start transcribing</Link><Link href="/room/new" className="btn-ghost text-sm">Open a meeting</Link></div>
  </section>
}
