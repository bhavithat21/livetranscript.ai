'use client'
import { useEffect, useRef, useState } from 'react'
import { Markdown } from '@/components/copilot/Markdown'
import { requestInterview, downloadInterview } from '@/lib/interview/client'
import { reviewExcerpt, type InterviewSession } from '@/lib/interview/session'
import type { HistoryStore } from '@/lib/interview/history'

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
    <section className="rounded-xl border border-black/[0.07] bg-white/50 p-5 sm:p-7">
      <h2 className="font-[family-name:var(--font-serif)] text-2xl">Feedback</h2>
      <p className="mt-2 text-sm text-black/60">Review what happened, inspect the evidence, and turn each session into a concrete next improvement.</p>
      {!sessions.length ? <div className="mt-5 rounded-xl border border-dashed border-black/20 p-6 text-sm">No completed sessions yet. Finish live capture or a mock system test, or paste an existing transcript below.</div> : <>
        <label className="mt-5 block space-y-2 text-sm">Session<select className="w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2.5" value={session?.id ?? ''} onChange={(e) => { onSelect(e.target.value); setConfirmDelete(null); setError(null) }}>{sessions.map((item) => <option key={item.id} value={item.id}>{item.kind === 'tuning' ? 'System tuning' : item.kind === 'mock' ? 'Legacy practice' : 'Live'} · {item.title} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
        {session && <>
          <p className="mt-3 text-xs leading-relaxed text-black/60">{session.captureNote}</p>
          {session.kind === 'tuning' && <p className="mt-4 rounded-lg border border-black/[0.06] bg-black/[0.025] px-3 py-2.5 text-sm text-black/60">Evaluating the AI system, not the candidate. Suggested instruction changes remain recommendations until tested and applied in Mock.</p>}
          <div className="mt-4 flex flex-wrap gap-2"><button className="btn-signal" disabled={!!reviewingId || !session.transcript.trim()} onClick={() => void review()}>{reviewingId === session.id ? 'Reviewing session…' : session.feedback ? 'Regenerate review' : 'Generate review'}</button>{reviewingId && <button className="btn-ghost" onClick={cancel}>Cancel review</button>}<button className="btn-ghost" onClick={() => exportSession(session)}>Export report &amp; transcript</button><button className="btn-ghost" disabled={reviewingId === session.id} onClick={() => setConfirmDelete(session.id)}>Delete session</button></div>
          {confirmDelete === session.id && <div role="group" aria-label="Confirm session deletion" className="mt-4 rounded-xl border border-black/15 p-4"><p className="text-sm">Delete this session and its feedback from this browser? Export it first to keep a copy. This cannot be undone.</p><div className="mt-3 flex gap-2"><button className="btn-ghost" onClick={() => { store.remove(session.id); setConfirmDelete(null); onSelect(null) }}>Delete permanently</button><button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Keep session</button></div></div>}
          {session.feedbackCoverage && <p className="mt-5 rounded-lg bg-black/[0.025] p-3 text-sm text-black/60">{session.feedbackCoverage}</p>}
          {session.feedback && <div className="mt-5 break-words" aria-label="Generated interview feedback"><Markdown>{session.feedback}</Markdown></div>}
          {!session.feedback && <p className="mt-4 text-sm text-black/50">Choose Generate feedback to send this transcript or system test report to the configured AI provider. No review has been generated yet.</p>}
          <details className="mt-6 border-t border-black/[0.07] pt-4"><summary className="cursor-pointer text-sm font-medium">View captured transcript / system tests</summary><pre className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{session.transcript}</pre></details>
        </>}
      </>}
      {reviewingId && <p role="status" className="mt-3 text-sm">Generating feedback for the session selected when review started. Switching tabs does not lose it.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-[color:var(--stop)]">{error}</p>}
    </section>
    <details className="rounded-xl border border-black/[0.07] bg-white/50 p-5"><summary className="cursor-pointer font-medium">Review an existing transcript</summary><label className="mt-4 block space-y-2 text-sm">Paste transcript (identify Interviewer and Candidate where known)<textarea rows={7} maxLength={500_000} value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full rounded-xl border border-black/15 bg-transparent p-3" /></label><button className="btn-ghost mt-3" disabled={!importText.trim()} onClick={importTranscript}>Add to feedback history</button></details>
    <p className="text-xs leading-relaxed text-black/60">AI review is advisory, not a validated score or hiring prediction. Missing evidence is not poor performance. System feedback never applies settings or trains model weights automatically.</p>
  </div>
}
