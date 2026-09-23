'use client'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CheckCheck, Clock3, Download, FileText, FlaskConical, Radio, Trash2 } from 'lucide-react'
import { Markdown } from '@/components/copilot/Markdown'
import { requestInterview, downloadInterview } from '@/lib/interview/client'
import { reviewExcerpt, type InterviewSession } from '@/lib/interview/session'
import type { HistoryStore } from '@/lib/interview/history'
import styles from './Interview.module.css'

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
      <dl className={styles.feedbackStats}>
        {stats.map(({ label, value, detail, icon: Icon }) => <div key={label} className={styles.stat}>
          <dt ><Icon size={14} className="shrink-0" aria-hidden />{label}</dt>
          <dd >{value}</dd>
          <dd >{detail}</dd>
        </div>)}
      </dl>
    </section>

    {!sessions.length ? <section className={styles.feedbackEmpty}>
      <FileText size={24} className="mx-auto text-black/30" aria-hidden />
      <h2 className="mt-4 text-lg font-semibold tracking-tight">Your session history starts here</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-black/50">Finish live capture or a mock system test to review the evidence and choose your next improvement. You can also add an existing transcript below.</p>
    </section> : <div className={styles.feedbackGrid}>
      <section aria-labelledby="feedback-history-heading" className={`${styles.card} overflow-hidden`}>
        <div className={styles.cardHeader}>
          <h2 id="feedback-history-heading" className="text-sm font-semibold">Session history</h2>
          <span className="text-xs tabular-nums text-black/40">{sessions.length} saved</span>
        </div>
        <ul className={styles.historyList}>
          {sessions.map((item) => {
            const Icon = item.kind === 'tuning' ? FlaskConical : item.kind === 'mock' ? FileText : Radio
            const selected = item.id === session?.id
            return <li key={item.id} className="min-w-0">
              <button type="button" aria-label={`View ${item.title}`} aria-pressed={selected} aria-controls="feedback-selected-session" onClick={() => { onSelect(item.id); setConfirmDelete(null); setError(null) }} className={styles.historyItem}>
                <span className={styles.historyIcon}><Icon size={15} aria-hidden /></span>
                <span className={styles.historyContent}>
                  <span className={styles.historyTitle}>{item.title}</span>
                  <span className={styles.historyMeta}>{kindLabel(item.kind)} · {dateLabel(item.createdAt)}</span>
                  <span className={styles.historyBottom}><span>{item.durationSeconds > 0 ? durationLabel(item.durationSeconds) : 'No duration captured'}</span><span className="inline-flex items-center gap-1">{hasReview(item) && <CheckCheck size={12} aria-hidden />}{reviewingId === item.id ? 'Reviewing…' : hasReview(item) ? 'Reviewed' : 'Awaiting review'}</span></span>
                </span>
                <ArrowUpRight size={14} className={`mt-1 shrink-0 ${selected ? 'text-black/55' : 'text-black/20'}`} aria-hidden />
              </button>
            </li>
          })}
        </ul>
      </section>

      {session && <section id="feedback-selected-session" aria-labelledby="feedback-session-heading" className={`${styles.card} ${styles.feedbackDetail}`}>
        <div className={styles.detailMeta}><span>{kindLabel(session.kind)} session</span><span>{dateLabel(session.createdAt)}</span></div>
        <h2 id="feedback-session-heading" className="mt-2 break-words text-xl font-semibold tracking-tight">{session.title}</h2>
        <p className={`${styles.caption} mt-3`}>{session.captureNote}</p>
        {session.kind === 'tuning' && <p className={`${styles.labNotice} mt-4`}>This review evaluates the AI system. Suggested instruction changes remain recommendations until tested and applied in Mock.</p>}

        <div className={styles.detailActions}>
          <button type="button" className="btn-signal text-sm" disabled={!!reviewingId || !session.transcript.trim()} aria-busy={reviewingId === session.id} onClick={() => void review()}>{reviewingId === session.id ? 'Reviewing session…' : hasReview(session) ? 'Regenerate review' : 'Generate review'}</button>
          <button type="button" className="btn-ghost gap-1.5 text-sm" onClick={() => exportSession(session)}><Download size={14} aria-hidden />Export report &amp; transcript</button>
          <button type="button" className="btn-ghost gap-1.5 text-sm" disabled={reviewingId === session.id} onClick={() => setConfirmDelete(session.id)}><Trash2 size={14} aria-hidden />Delete session</button>
        </div>
        {confirmDelete === session.id && <div role="group" aria-label="Confirm session deletion" className={styles.deleteConfirm}><p className="text-sm leading-relaxed">Delete this session and its review from this browser? Export it first to keep a copy. This cannot be undone.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-ghost text-sm" disabled={reviewingId === session.id} onClick={() => { store.remove(session.id); setConfirmDelete(null); onSelect(null) }}>Delete permanently</button><button type="button" className="btn-ghost text-sm" onClick={() => setConfirmDelete(null)}>Keep session</button></div></div>}
        {session.feedbackCoverage && <p className={`${styles.labNotice} mt-5`}>{session.feedbackCoverage}</p>}
        {hasReview(session) ? <div className={styles.feedbackReview} aria-label="Generated interview feedback"><Markdown>{session.feedback!}</Markdown></div> : <div className={styles.feedbackPlaceholder}><h3 className="text-sm font-medium">Ready for a closer look</h3><p className="mt-2 text-sm leading-relaxed text-black/50">Choose Generate review to send this transcript or system test report to the configured AI provider. No review has been generated yet.</p></div>}
        <details className={styles.transcriptDetails}><summary className="cursor-pointer text-sm font-medium">View captured transcript / system tests</summary><pre className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{session.transcript}</pre></details>
      </section>}
    </div>}

    {reviewingId && <div className={styles.activityNotice}><p role="status" className="text-sm leading-relaxed">Generating a review for <span className="font-medium">{sessions.find((item) => item.id === reviewingId)?.title ?? 'the original session'}</span>. You can browse other sessions while it runs.</p><button type="button" className="btn-ghost shrink-0 text-sm" onClick={cancel}>Cancel review</button></div>}
    {error && <p role="alert" className="text-sm text-[color:var(--stop)]">{error}</p>}

    <details className={`${styles.card} ${styles.importPanel}`}><summary className="cursor-pointer text-sm font-medium">Review an existing transcript</summary><label className={`${styles.field} mt-4`}>Paste transcript (identify Interviewer and Candidate where known)<textarea rows={7} maxLength={500_000} value={importText} onChange={(e) => setImportText(e.target.value)} className="resize-none" /></label><button type="button" className="btn-ghost mt-3 text-sm" disabled={!importText.trim()} onClick={importTranscript}>Add to feedback history</button></details>
    <p className={styles.caption}>AI review is advisory, not a validated score or hiring prediction. Missing evidence is not poor performance. System feedback never applies settings or trains model weights automatically.</p>
  </div>
}
