'use client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useRef, useState, useTransition } from 'react'
import { ArrowUpRight, FileText, Trash2 } from 'lucide-react'
import { formatDate, formatDuration } from '@/lib/format'
import { deleteSession, type SessionSummaryRow } from '@/app/(app)/session-actions'
import { DeleteSessionDialog } from './DeleteSessionDialog'

type Summary = { summary?: string; keyPoints?: string[]; actionItems?: string[] } | null

export function SessionCard({ session }: { session: SessionSummaryRow }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const deletingRef = useRef(false)
  const [gone, setGone] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const summary = session.summary as Summary
  const shared = Boolean(session.shareToken)
  const keyPoints = summary?.keyPoints?.length ?? 0
  const actions = summary?.actionItems?.length ?? 0

  const onDelete = () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setError(null)
    startTransition(async () => {
      try {
        await deleteSession(session.id)
        setConfirmDelete(false)
        setGone(true)
        router.refresh()
      } catch {
        setError('The transcript could not be deleted. It has been kept here; try again.')
      } finally { deletingRef.current = false }
    })
  }

  if (gone) return null

  return (
    <article className="group flex h-full flex-col rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 transition-colors hover:border-[color:var(--signal)]/40">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] text-[color:var(--signal)]"><FileText size={18} aria-hidden /></span>
        <div className="flex items-center gap-2">
          {shared && <span className="rounded-md border border-[color:var(--line)] px-2 py-1 text-xs font-medium text-[color:var(--muted)]">Shared link</span>}
          <button type="button" onClick={() => setConfirmDelete(true)} disabled={pending} aria-label={`Delete ${session.title}`} title="Delete transcript" className="inline-flex h-11 w-11 items-center justify-center rounded-lg text-[color:var(--muted)] transition-colors hover:bg-[color:var(--stop)]/10 hover:text-[color:var(--stop)]"><Trash2 size={15} aria-hidden /></button>
        </div>
      </div>
      <h3 className="break-words text-base font-semibold leading-snug"><Link href={`/session/${session.id}`} className="transition-colors hover:text-[color:var(--signal)]">{session.title}</Link></h3>
      <p className="mt-2 line-clamp-3 text-sm leading-6 text-[color:var(--muted)]">{summary?.summary || 'Open this transcript to review the conversation.'}</p>
      {(keyPoints > 0 || actions > 0) && <div className="mt-3 flex flex-wrap gap-3 text-xs text-[color:var(--muted)]">{keyPoints > 0 && <span>{keyPoints} key points</span>}{actions > 0 && <span>{actions} action items</span>}</div>}
      <div className="mt-auto pt-5"><div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[color:var(--line)] pt-2 text-xs text-[color:var(--muted)]">
        <span>{formatDate(session.createdAt)}</span>
        <span className="tabular-nums">{formatDuration(session.durationSeconds)}</span>
        <Link href={`/session/${session.id}`} className="ml-auto inline-flex min-h-11 items-center gap-1 font-medium text-[color:var(--signal)] hover:underline" aria-label={`Open ${session.title}`}>Open<ArrowUpRight size={14} aria-hidden /></Link>
      </div></div>
      <DeleteSessionDialog open={confirmDelete} title={session.title} pending={pending} error={error} onCancel={() => { setConfirmDelete(false); setError(null) }} onDelete={onDelete} />
    </article>
  )
}
