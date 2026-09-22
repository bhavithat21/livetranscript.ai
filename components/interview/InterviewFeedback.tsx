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
    controller.current = abort
    busy.current = true
    setReviewingId(selected.id)
    setError(null)
    try {
      const feedback = await requestInterview({ action: 'feedback', transcript: excerpt.transcript, captureNote: selected.captureNote, coverage: excerpt.coverage }, abort.signal)
      if (generation.current === token) store.review(selected.id, feedback, excerpt.coverage)
    } catch (e) {
      if (!abort.signal.aborted && generation.current === token) setError(e instanceof Error ? e.message : 'Could not generate feedback. Please retry.')
    } finally {
      if (generation.current === token) { busy.current = false; setReviewingId(null); controller.current = null }
    }
  }
  function cancel() {
    generation.current += 1
    controller.current?.abort()
    controller.current = null
    busy.current = false
    setReviewingId(null)
  }
  function importTranscript() {
    if (!importText.trim()) return
    try {
      const imported: InterviewSession = {
        id: crypto.randomUUID(), kind: 'live', title: 'Imported interview transcript', createdAt: Date.now(),
        durationSeconds: 0, transcript: importText.trim(), turns: [],
        captureNote: 'Manually imported transcript. Audio coverage, speaker identities, timing, and whether text includes AI suggestions are unverified. Evaluate candidate answers only where the text clearly identifies them.',
      }
      store.add(imported)
      onSelect(imported.id)
      setImportText('')
      setError(null)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import this transcript.') }
  }
  function exportSession(selected: InterviewSession) {
    downloadInterview(selected.title, `# ${selected.title}\n\n${new Date(selected.createdAt).toISOString()}\n\n${selected.captureNote}\n\n${selected.feedbackCoverage ?? ''}\n\n${selected.feedback ?? 'Feedback not generated.'}\n\n## Transcript\n\n${selected.transcript}`)
  }

  return (
    <div className="space-y-5">
      <section className="reader-surface rounded-2xl p-5 sm:p-6">
        <h2 className="font-[family-name:var(--font-serif)] text-2xl">Interview Feedback</h2>
        <p className="mt-2 text-sm text-black/60">Review completed live and mock sessions. Feedback cites your captured answers, identifies strengths and gaps, and gives concrete practice steps.</p>
        {!sessions.length ? <div className="mt-5 rounded-xl border border-dashed border-black/20 p-6 text-sm">No completed interviews yet. Finish a live or mock interview, or paste an existing transcript below.</div> : <>
          <label className="mt-5 block space-y-2 text-sm">Session<select className="w-full rounded-xl border border-black/15 bg-transparent p-3" value={session?.id ?? ''} onChange={(e) => { onSelect(e.target.value); setConfirmDelete(null); setError(null) }}>{sessions.map((item) => <option key={item.id} value={item.id}>{item.kind === 'mock' ? 'Mock' : 'Live'} · {item.title} · {new Date(item.createdAt).toLocaleString()}</option>)}</select></label>
          {session && <>
            <p className="mt-3 text-xs leading-relaxed text-black/60">{session.captureNote}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button className="btn-signal" disabled={!!reviewingId || !session.transcript.trim()} onClick={() => void review()}>{reviewingId === session.id ? 'Reviewing interview…' : session.feedback ? 'Regenerate feedback' : 'Generate feedback'}</button>
              {reviewingId && <button className="btn-ghost" onClick={cancel}>Cancel review</button>}
              <button className="btn-ghost" onClick={() => exportSession(session)}>Export report &amp; transcript</button>
              <button className="btn-ghost" disabled={reviewingId === session.id} onClick={() => setConfirmDelete(session.id)}>Delete session</button>
            </div>
            {confirmDelete === session.id && <div role="group" aria-label="Confirm session deletion" className="mt-4 rounded-xl border border-black/15 p-4"><p className="text-sm">Delete this session and its feedback from this browser? Export it first to keep a copy. This cannot be undone.</p><div className="mt-3 flex gap-2"><button className="btn-ghost" onClick={() => { store.remove(session.id); setConfirmDelete(null); onSelect(null) }}>Delete permanently</button><button className="btn-ghost" onClick={() => setConfirmDelete(null)}>Keep session</button></div></div>}
            {session.feedbackCoverage && <p className="mt-5 rounded-xl bg-black/5 p-3 text-sm">{session.feedbackCoverage}</p>}
            {session.feedback && <div className="mt-5 break-words" aria-label="Generated interview feedback"><Markdown>{session.feedback}</Markdown></div>}
            {!session.feedback && <p className="mt-4 text-sm text-black/50">Choose Generate feedback to send this transcript to the configured AI provider. No report has been generated yet.</p>}
            <details className="mt-5 rounded-xl border border-black/10 p-4"><summary className="cursor-pointer text-sm font-medium">View captured transcript</summary><pre className="mt-4 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">{session.transcript}</pre></details>
          </>}
        </>}
        {reviewingId && <p role="status" className="mt-3 text-sm">Generating feedback for the selected session at the time you started review. You can switch tabs without losing it.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-[color:var(--stop)]">{error}</p>}
      </section>
      <details className="reader-surface rounded-2xl p-5"><summary className="cursor-pointer font-medium">Review an existing transcript</summary><label className="mt-4 block space-y-2 text-sm">Paste transcript (identify Interviewer and Candidate where known)<textarea rows={7} maxLength={500_000} value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full rounded-xl border border-black/15 bg-transparent p-3" /></label><button className="btn-ghost mt-3" disabled={!importText.trim()} onClick={importTranscript}>Add to feedback history</button></details>
      <p className="text-xs leading-relaxed text-black/60">AI feedback is coaching, not a validated assessment or hiring prediction. Transcripts cannot establish vocal delivery or nonverbal behavior. Missing or unidentifiable candidate answers are marked as insufficient evidence.</p>
    </div>
  )
}
