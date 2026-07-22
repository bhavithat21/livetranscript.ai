'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { SessionCard } from './SessionCard'
import { formatDate, formatDuration, recencyBucket, type RecencyBucket } from '@/lib/format'
import type { SessionSummaryRow } from '@/app/(app)/session-actions'

const BUCKET_ORDER: RecencyBucket[] = ['Today', 'This week', 'This month', 'Earlier']

type Summary = { summary?: string; keyPoints?: string[]; actionItems?: string[] } | null

// Client library: instant search + "shared only" filter over the rows already in
// memory (no extra query), a featured most-recent card, and recency grouping.
export function LibraryView({ sessions, now }: { sessions: SessionSummaryRow[]; now: number }) {
  const [q, setQ] = useState('')
  const [sharedOnly, setSharedOnly] = useState(false)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sessions.filter((s) => {
      if (sharedOnly && !s.shareToken) return false
      if (!needle) return true
      const sum = (s.summary as Summary)?.summary ?? ''
      return `${s.title} ${sum}`.toLowerCase().includes(needle)
    })
  }, [sessions, q, sharedOnly])

  const [featured, ...rest] = filtered

  const groups = useMemo(() => {
    const m = new Map<RecencyBucket, SessionSummaryRow[]>()
    for (const s of rest) {
      const b = recencyBucket(s.createdAt, now)
      ;(m.get(b) ?? m.set(b, []).get(b)!).push(s)
    }
    return BUCKET_ORDER.filter((b) => m.has(b)).map((b) => [b, m.get(b)!] as const)
  }, [rest, now])

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-3">
        <label className="glass flex flex-1 items-center gap-2 rounded-full px-4 py-2 text-sm">
          <Search size={15} className="text-black/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search transcripts…"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-black/35"
          />
        </label>
        <button
          onClick={() => setSharedOnly((v) => !v)}
          data-active={sharedOnly}
          className="btn-ghost text-sm"
        >
          Shared only
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="mt-16 text-center text-black/40">No transcripts match “{q}”.</p>
      ) : (
        <>
          {featured && <FeaturedCard session={featured} now={now} />}
          {groups.map(([bucket, rows]) => (
            <section key={bucket} className="mt-10">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-black/40">{bucket}</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((s, i) => (
                  <div key={s.id} className="rise-in" style={{ animationDelay: `${Math.min(i, 6) * 50}ms` }}>
                    <SessionCard session={s} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  )
}

// The most-recent session, promoted to a wide editorial card.
function FeaturedCard({ session, now }: { session: SessionSummaryRow; now: number }) {
  const summary = session.summary as Summary
  const shared = Boolean(session.shareToken)
  return (
    <Link
      href={`/session/${session.id}`}
      className="glass glass-interactive rise-in group mt-6 block rounded-3xl p-7"
    >
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[color:var(--signal)]">
        Most recent · {recencyBucket(session.createdAt, now)}
      </div>
      <h2 className="mt-2 font-[family-name:var(--font-serif)] text-3xl leading-tight tracking-[-0.01em]">
        {session.title}
      </h2>
      {summary?.summary && (
        <p className="mt-2 max-w-2xl leading-relaxed text-black/60">{summary.summary}</p>
      )}
      <div className="mt-4 flex items-center gap-3 text-sm text-black/40">
        <span>{formatDate(session.createdAt)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatDuration(session.durationSeconds)}</span>
        {shared && (
          <span className="rounded-full bg-emerald-700/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Shared
          </span>
        )}
        <span className="ml-auto text-[color:var(--signal)] opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  )
}
