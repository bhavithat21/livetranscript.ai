'use client'
import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Clock3, FileText, Link2, Search, X } from 'lucide-react'
import { formatDate, formatDuration } from '@/lib/format'
import { isShareValid } from '@/lib/share'
import type { SessionSummaryRow } from '@/app/(app)/session-actions'

const PAGE_SIZE = 12

type Summary = { summary?: string; keyPoints?: string[]; actionItems?: string[] } | null

// Search stays in the tab: transcript content should never become URL history.
// The server supplies at most 200 newest rows; this view bounds each page to 12.
export function LibraryView({ sessions, now }: { sessions: SessionSummaryRow[]; now: number }) {
  const [q, setQ] = useState('')
  const [sharedOnly, setSharedOnly] = useState(false)
  const [page, setPage] = useState(1)
  const searchInput = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return sessions.filter((session) => {
      if (sharedOnly && !isShareValid(session, now)) return false
      if (!needle) return true
      const summary = (session.summary as Summary)?.summary ?? ''
      return `${session.title} ${summary}`.toLowerCase().includes(needle)
    })
  }, [sessions, q, sharedOnly, now])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, pages)
  const first = (currentPage - 1) * PAGE_SIZE
  const visible = filtered.slice(first, first + PAGE_SIZE)

  function clearSearch() {
    setQ('')
    setPage(1)
    searchInput.current?.focus()
  }

  return (
    <section className="mt-7 overflow-hidden rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)]" aria-labelledby="transcript-list-heading">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[color:var(--line)] p-4 sm:p-5">
        <div><h2 id="transcript-list-heading" className="text-base font-semibold">Saved sessions</h2><p className="mt-1 text-xs text-[color:var(--muted)]">Open a transcript to review, export, or manage sharing.</p></div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <div className="flex min-h-11 min-w-0 flex-1 items-center rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] pl-3 focus-within:border-[color:var(--signal)] focus-within:ring-2 focus-within:ring-[color:var(--accent-soft)] sm:w-64">
            <Search size={15} className="shrink-0 text-[color:var(--muted)]" aria-hidden />
            <input
              ref={searchInput}
              value={q}
              onChange={(event) => { setQ(event.target.value); setPage(1) }}
              aria-label="Search transcripts"
              placeholder="Search transcripts…"
              className="min-h-11 min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-[color:var(--muted)]"
            />
            {q && <button type="button" aria-label="Clear transcript search" onClick={clearSearch} className="flex min-h-11 min-w-10 cursor-pointer items-center justify-center rounded-lg text-[color:var(--muted)] hover:bg-[color:var(--line)]"><X size={15} aria-hidden /></button>}
          </div>
          <button type="button" onClick={() => { setSharedOnly((value) => !value); setPage(1) }} aria-pressed={sharedOnly} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-xs font-medium transition-colors hover:bg-[color:var(--surface-soft)] ${sharedOnly ? 'border-[color:var(--signal)] bg-[color:var(--accent-soft)] text-[color:var(--signal)]' : 'border-[color:var(--line)] text-[color:var(--muted)]'}`}><Link2 size={14} aria-hidden /> Shared only</button>
        </div>
      </div>

      <div className="hidden grid-cols-[minmax(0,1fr)_120px_110px_100px_30px] gap-4 border-b border-[color:var(--line)] bg-[color:var(--surface-soft)] px-5 py-3 text-[11px] font-medium text-[color:var(--muted)] lg:grid" aria-hidden>
        <span>Transcript</span><span>Recorded</span><span>Duration</span><span>Access</span><span />
      </div>

      {visible.length === 0 ? (
        <div className="flex min-h-72 flex-col items-center justify-center px-5 py-12 text-center">
          <Search size={26} className="text-[color:var(--muted)]" aria-hidden />
          <h3 className="mt-4 text-base font-semibold">No matching transcripts</h3>
          <p className="mt-2 max-w-sm break-words text-sm leading-relaxed text-[color:var(--muted)]">{q ? `No saved sessions match “${q}”${sharedOnly ? ' with an active share link' : ''}.` : 'None of these transcripts has an active share link.'}</p>
          <button type="button" onClick={() => { setSharedOnly(false); clearSearch() }} className="btn-ghost mt-5 text-sm">Reset filters</button>
        </div>
      ) : (
        <ul aria-label="Transcripts" className="divide-y divide-[color:var(--line)]">
          {visible.map((session) => {
            const summary = (session.summary as Summary)?.summary
            const shared = isShareValid(session, now)
            return <li key={session.id}>
              <Link href={`/session/${session.id}`} className="group grid min-h-24 items-center gap-3 px-4 py-4 transition-colors hover:bg-[color:var(--surface-soft)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--signal)] sm:px-5 lg:grid-cols-[minmax(0,1fr)_120px_110px_100px_30px] lg:gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] text-[color:var(--signal)]"><FileText size={17} aria-hidden /></span>
                  <div className="min-w-0"><h3 className="break-words text-sm font-semibold leading-relaxed group-hover:text-[color:var(--signal)]">{session.title}</h3><p className="mt-1 line-clamp-1 text-xs leading-relaxed text-[color:var(--muted)]">{summary || 'Transcript ready to review.'}</p></div>
                </div>
                <span className="hidden text-xs text-[color:var(--muted)] lg:block">{formatDate(session.createdAt)}</span>
                <span className="hidden text-xs tabular-nums text-[color:var(--muted)] lg:block">{formatDuration(session.durationSeconds)}</span>
                <span className="hidden text-xs lg:block"><span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${shared ? 'bg-[color:var(--accent-soft)] text-[color:var(--signal)]' : 'bg-[color:var(--surface-soft)] text-[color:var(--muted)]'}`}>{shared && <Link2 size={12} aria-hidden />}{shared ? 'Shared' : 'Private'}</span></span>
                <ArrowRight size={16} className="hidden text-[color:var(--muted)] transition-transform group-hover:translate-x-0.5 lg:block" aria-hidden />
                <div className="ml-12 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--muted)] lg:hidden"><span>{formatDate(session.createdAt)}</span><span className="flex items-center gap-1 tabular-nums"><Clock3 size={12} aria-hidden />{formatDuration(session.durationSeconds)}</span><span>{shared ? 'Shared' : 'Private'}</span><ArrowRight size={14} className="ml-auto" aria-hidden /></div>
              </Link>
            </li>
          })}
        </ul>
      )}

      <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-t border-[color:var(--line)] px-4 py-3 sm:px-5">
        <p role="status" className="text-xs text-[color:var(--muted)]">{filtered.length ? `${first + 1}–${Math.min(first + PAGE_SIZE, filtered.length)} of ${filtered.length} transcripts` : '0 transcripts'}{sessions.length >= 200 && ' · Latest 200 loaded'}</p>
        {pages > 1 && <nav aria-label="Transcript pages" className="flex items-center gap-1">
          <button type="button" aria-label="Previous transcript page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)} className="btn-ghost min-h-10 gap-1.5 px-3 text-xs"><ChevronLeft size={14} aria-hidden /> Previous</button>
          <span className="px-2 text-xs tabular-nums text-[color:var(--muted)]">{currentPage} / {pages}</span>
          <button type="button" aria-label="Next transcript page" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)} className="btn-ghost min-h-10 gap-1.5 px-3 text-xs">Next <ChevronRight size={14} aria-hidden /></button>
        </nav>}
      </div>
    </section>
  )
}
