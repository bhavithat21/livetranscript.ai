'use client'
import Link from 'next/link'
import { formatDate, formatDuration } from '@/lib/format'
import type { SessionSummaryRow } from '@/app/(app)/session-actions'

type Summary = { summary?: string } | null

export function SessionCard({ session }: { session: SessionSummaryRow }) {
  const summary = session.summary as Summary
  const shared = Boolean(session.shareToken)
  return (
    <Link
      href={`/session/${session.id}`}
      className="glass glass-interactive group flex flex-col rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-[family-name:var(--font-serif)] text-lg leading-snug tracking-[-0.01em]">
          {session.title}
        </h3>
        {shared && (
          <span className="shrink-0 rounded-full bg-emerald-700/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
            Shared
          </span>
        )}
      </div>
      {summary?.summary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-black/55">{summary.summary}</p>
      )}
      <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-black/40">
        <span>{formatDate(session.createdAt)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatDuration(session.durationSeconds)}</span>
        <span className="ml-auto text-emerald-700 opacity-0 transition-opacity group-hover:opacity-100">
          Open →
        </span>
      </div>
    </Link>
  )
}
