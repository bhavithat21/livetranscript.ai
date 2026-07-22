'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { formatDate, formatDuration } from '@/lib/format'
import { deleteSession, type SessionSummaryRow } from '@/app/(app)/session-actions'

type Summary = { summary?: string; keyPoints?: string[]; actionItems?: string[] } | null

export function SessionCard({ session }: { session: SessionSummaryRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [gone, setGone] = useState(false)
  const summary = session.summary as Summary
  const shared = Boolean(session.shareToken)
  const keyPoints = summary?.keyPoints?.length ?? 0
  const actions = summary?.actionItems?.length ?? 0

  // Delete without opening the session. preventDefault stops the wrapping Link nav.
  const onDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete “${session.title}”? This can’t be undone.`)) return
    setGone(true)
    startTransition(async () => {
      await deleteSession(session.id)
      router.refresh()
    })
  }

  if (gone) return null

  return (
    <Link
      href={`/session/${session.id}`}
      className="glass glass-interactive group relative flex h-full flex-col overflow-hidden rounded-2xl p-5"
    >
      {/* Hover accent — a signal-colored rule that scales in from the left. */}
      <span
        className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-[color:var(--signal)] transition-transform duration-300 group-hover:scale-x-100"
        aria-hidden
      />
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-[family-name:var(--font-serif)] text-lg leading-snug tracking-[-0.01em]">
          {session.title}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {shared && (
            <span className="rounded-full bg-emerald-700/10 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Shared
            </span>
          )}
          {/* Hover/focus-revealed delete — kept off the tap target's main body. */}
          <button
            onClick={onDelete}
            disabled={pending}
            aria-label={`Delete ${session.title}`}
            title="Delete"
            className="flex h-11 w-11 items-center justify-center rounded-full text-black/30 opacity-100 transition-opacity hover:bg-[color:var(--stop)]/10 hover:text-[color:var(--stop)] focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      {summary?.summary && (
        <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-black/55">{summary.summary}</p>
      )}
      {(keyPoints > 0 || actions > 0) && (
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs text-black/45">
          {keyPoints > 0 && <span className="rounded-full bg-black/5 px-2 py-0.5">{keyPoints} points</span>}
          {actions > 0 && <span className="rounded-full bg-black/5 px-2 py-0.5">{actions} actions</span>}
        </div>
      )}
      <div className="mt-auto flex items-center gap-3 pt-4 text-xs text-black/40">
        <span>{formatDate(session.createdAt)}</span>
        <span aria-hidden>·</span>
        <span className="tabular-nums">{formatDuration(session.durationSeconds)}</span>
        <span className="ml-auto text-[color:var(--signal)] transition-transform group-hover:translate-x-0.5">
          Open →
        </span>
      </div>
    </Link>
  )
}
