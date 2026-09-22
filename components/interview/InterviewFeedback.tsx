'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CheckCheck, Clock3, Download, FileText, FlaskConical, Radio, Trash2 } from 'lucide-react'
import { Markdown } from '@/components/copilot/Markdown'
import { requestInterview, downloadInterview } from '@/lib/interview/client'
import { reviewExcerpt, type InterviewSession } from '@/lib/interview/session'
import type { HistoryStore } from '@/lib/interview/history'

function kindLabel(kind: InterviewSession['kind']) {
  return kind === 'tuning' ? 'System tuning' : kind === 'mock' ? 'Legacy practice' : 'Live'
}

function durationLabel(duration: number) {
  if (!Number.isFinite(duration)) return 'Unavailable'
  const seconds = Math.max(0, Math.floor(duration))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainder = seconds % 60
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', remainder || (!hours && !minutes) ? `${remainder}s` : ''].filter(Boolean).join(' ')
}

function dateLabel(createdAt: number) {
  const date = new Date(createdAt)
  return Number.isFinite(date.getTime()) ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date unavailable'
}

function hasReview(session: InterviewSession) { return Boolean(session.feedback?.trim()) }

export function InterviewFeedback({ sessions, selectedId, onSelect, store }: {
  sessions: InterviewSession[]; selectedId: string | null; onSelect: (id: string | null) => void; store: HistoryStore
}) {
  const session = sessions.find((item) => item.id === selectedId) ?? sessions[0]
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const controller = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const busy = useRef(false)
  const stats = [
    { label: 'Live sessions', value: sessions.filter((item) => item.kind === 'live').length, detail: 'Live and imported', icon: Radio },
    { label: 'System tests', value: sessions.filter((item) => item.kind === 'tuning').length, detail: 'Saved tuning runs', icon: FlaskConical },
    { label: 'Session time', value: durationLabel(sessions.reduce((total, item) => total + item.durationSeconds, 0)), detail: 'Known durations only', icon: Clock3 },
    { label: 'Reviewed', value: sessions.filter(hasReview).length, detail: 'Generated reviews', icon: CheckCheck },
  ]
  useEffect(() => () => { generation.current += 1; controller.current?.abort() }, [])
  async function review() {
    if (!session || busy.current) return
    const selected = session
    const excerpt = reviewExcerpt(selected.transcript)
    const token = ++generation.current
    const abort = new AbortController()
    controller.current = abort; busy.current = true; setReviewingId(selected.id); setError(null)
    try {
      const feedback = await requestInterview({ action: 'feedback', subject: selected.kind === 'tuning' ? 'copilot' : 'candidate', transcript: excerpt.transcript, captureNote: selected.captureNote, coverage: excerpt.coverage }, abort.signal)
      if (generation.current === token) store.review(selected.id, feedback, excerpt.coverage)
    } catch (e) {
      if (!abort.signal.aborted && generation.current === token) setError(e instanceof Error ? e.message : 'Could not generate feedback. Please retry.')
    } finally { if (generation.current === token) { busy.current = false; setReviewingId(null); controller.current = null } }
  }
  function cancel() { generation.current += 1; controller.current?.abort(); controller.current = null; busy.current = false; setReviewingId(null) }
  function importTranscript() {
    if (!importText.trim()) return
    try {
      const imported: InterviewSession = { id: crypto.randomUUID(), kind: 'live', title: 'Imported interview transcript', createdAt: Date.now(), durationSeconds: 0, transcript: importText.trim(), turns: [], captureNote: 'Manually imported transcript. Audio coverage, speaker identities, timing, and whether text includes AI suggestions are unverified. Evaluate candidate answers only where the text clearly identifies them.' }
      store.add(imported); onSelect(imported.id); setImportText(''); setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import this transcript.') }
  }
  function exportSession(selected: InterviewSession) {
    downloadInterview(selected.title, `# ${selected.title}\n\n${new Date(selected.createdAt).toISOString()}\n\n${selected.captureNote}\n\n${selected.feedbackCoverage ?? ''}\n\n${selected.feedback ?? 'Feedback not generated.'}\n\n## Transcript / system test records\n\n${selected.transcript}`)
  }
  return <div className="space-y-5">
    <section aria-label="Session overview">
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {stats.map(({ label, value, detail, icon: Icon }) => <div key={label} className="min-w-0 rounded-xl border border-black/[0.07] bg-white/50 p-4">
          <dt className="flex items-center gap-2 text-xs font-medium text-black/50"><Icon size={14} className="shrink-0" aria-hidden />{label}</dt>
          <dd className="mt-2 break-words text-2xl font-semibold tabular-nums tracking-tight">{value}</dd>
          <dd className="mt-1 text-[11px] text-black/40">{detail}</dd>
        </div>)}
      </dl>
    </section>

    {!sessions.length ? <section className="rounded-xl border border-dashed border-black/15 bg-white/40 px-5 py-10 text-center sm:p-12">
      <FileText size={24} className="mx-auto text-black/30" aria-hidden />
      <h2 className="mt-4 text-lg font-semibold tracking-tight">Your session history starts here</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-black/50">Finish live capture or a mock system test to review the evidence and choose your next improvement. You can also add an existing transcript below.</p>
    </section> : <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.4fr)]">
      <section aria-labelledby="feedback-history-heading" className="min-w-0 self-start overflow-hidden rounded-xl border border-black/[0.07] bg-white/50">
        <div className="flex items-center justify-between gap-3 border-b border-black/[0.07] px-4 py-4">
          <h2 id="feedback-history-heading" className="text-sm font-semibold">Session history</h2>
          <span className="text-xs tabular-nums text-black/40">{sessions.length} saved</span>
        </div>
        <ul className="max-h-[32rem] overflow-y-auto p-2">
          {sessions.map((item) => {
            const Icon = item.kind === 'tuning' ? FlaskConical : item.kind === 'mock' ? FileText : Radio
            const selected = item.id === session?.id
            return <li key={item.id} className="min-w-0">
              <button type="button" aria-label={`View ${item.title}`} aria-pressed={selected} aria-controls="feedback-selected-session" onClick={() => { onSelect(item.id); setConfirmDelete(null); setError(null) }} className={`flex min-h-20 w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors ${selected ? 'bg-black/[0.055]' : 'hover:bg-black/[0.025]'}`}>
                <span className="mt-0.5 rounded-lg border border-black/[0.07] bg-white/40 p-2 text-black/45"><Icon size={15} aria-hidden /></span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-sm font-medium leading-snug">{item.title}</span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-black/45">{kindLabel(item.kind)} · {dateLabel(item.createdAt)}</span>
                  <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-black/50"><span>{item.durationSeconds > 0 ? durationLabel(item.durationSeconds) : 'No duration captured'}</span><span className="inline-flex items-center gap-1">{hasReview(item) && <CheckCheck size={12} aria-hidden />}{reviewingId === item.id ? 'Reviewing…' : hasReview(item) ? 'Reviewed' : 'Awaiting review'}</span></span>
                </span>
                <ArrowUpRight size={14} className={`mt-1 shrink-0 ${selected ? 'text-black/55' : 'text-black/20'}`} aria-hidden />
              </button>
            </li>
          })}
        </ul>
      </section>

      {session && <section id="feedback-selected-session" aria-labelledby="feedback-session-heading" className="min-w-0 rounded-xl border border-black/[0.07] bg-white/50 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-black/45"><span>{kindLabel(session.kind)} session</span><span>{dateLabel(session.createdAt)}</span></div>
        <h2 id="feedback-session-heading" className="mt-2 break-words text-xl font-semibold tracking-tight">{session.title}</h2>
        <p className="mt-3 text-xs leading-relaxed text-black/55">{session.captureNote}</p>
        {session.kind === 'tuning' && <p className="mt-4 rounded-lg border border-black/[0.06] bg-black/[0.025] px-3 py-2.5 text-sm leading-relaxed text-black/60">This review evaluates the AI system. Suggested instruction changes remain recommendations until tested and applied in Mock.</p>}

        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className="btn-signal text-sm" disabled={!!reviewingId || !session.transcript.trim()} aria-busy={reviewingId === session.id} onClick={() => void review()}>{reviewingId === session.id ? 'Reviewing session…' : hasReview(session) ? 'Regenerate review' : 'Generate review'}</button>
          <button type="button" className="btn-ghost gap-1.5 text-sm" onClick={() => exportSession(session)}><Download size={14} aria-hidden />Export report &amp; transcript</button>
          <button type="button" className="btn-ghost gap-1.5 text-sm" disabled={reviewingId === session.id} onClick={() => setConfirmDelete(session.id)}><Trash2 size={14} aria-hidden />Delete session</button>
        </div>
        {confirmDelete === session.id && <div role="group" aria-label="Confirm session deletion" className="mt-4 rounded-xl border border-black/15 p-4"><p className="text-sm leading-relaxed">Delete this session and its review from this browser? Export it first to keep a copy. This cannot be undone.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-ghost text-sm" disabled={reviewingId === session.id} onClick={() => { store.remove(session.id); setConfirmDelete(null); onSelect(null) }}>Delete permanently</button><button type="button" className="btn-ghost text-sm" onClick={() => setConfirmDelete(null)}>Keep session</button></div></div>}
        {session.feedbackCoverage && <p className="mt-5 rounded-lg bg-black/[0.025] p-3 text-xs leading-relaxed text-black/55">{session.feedbackCoverage}</p>}
        {hasReview(session) ? <div className="mt-5 break-words" aria-label="Generated interview feedback"><Markdown>{session.feedback!}</Markdown></div> : <div className="mt-5 rounded-lg border border-dashed border-black/10 px-4 py-5"><h3 className="text-sm font-medium">Ready for a closer look</h3><p className="mt-2 text-sm leading-relaxed text-black/50">Choose Generate review to send this transcript or system test report to the configured AI provider. No review has been generated yet.</p></div>}
        <details className="mt-6 border-t border-black/[0.07] pt-4"><summary className="cursor-pointer text-sm font-medium">View captured transcript / system tests</summary><pre className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{session.transcript}</pre></details>
      </section>}
    </div>}

    {reviewingId && <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/[0.07] bg-black/[0.025] px-4 py-3"><p role="status" className="text-sm leading-relaxed">Generating a review for <span className="font-medium">{sessions.find((item) => item.id === reviewingId)?.title ?? 'the original session'}</span>. You can browse other sessions while it runs.</p><button type="button" className="btn-ghost shrink-0 text-sm" onClick={cancel}>Cancel review</button></div>}
    {error && <p role="alert" className="text-sm text-[color:var(--stop)]">{error}</p>}

    <details className="rounded-xl border border-black/[0.07] bg-white/50 p-5"><summary className="cursor-pointer text-sm font-medium">Review an existing transcript</summary><label className="mt-4 block space-y-2 text-sm">Paste transcript (identify Interviewer and Candidate where known)<textarea rows={7} maxLength={500_000} value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full resize-none rounded-xl border border-black/15 bg-transparent p-3" /></label><button type="button" className="btn-ghost mt-3 text-sm" disabled={!importText.trim()} onClick={importTranscript}>Add to feedback history</button></details>
    <p className="text-xs leading-relaxed text-black/50">AI review is advisory, not a validated score or hiring prediction. Missing evidence is not poor performance. System feedback never applies settings or trains model weights automatically.</p>
  </div>
}
