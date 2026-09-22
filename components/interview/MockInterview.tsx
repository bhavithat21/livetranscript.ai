'use client'
import { useEffect, useRef, useState } from 'react'
import { Mic, Send, Square } from 'lucide-react'
import { DEFAULT_CONFIG, ROUNDS, mockTranscript, type InterviewConfig, type InterviewSession, type InterviewTurn } from '@/lib/interview/session'
import { requestInterview, downloadInterview } from '@/lib/interview/client'
import { captureText, useInterviewRecorder } from '@/lib/interview/useInterviewRecorder'

export function MockInterview({ blocked, onActivity, onComplete }: {
  blocked: boolean; onActivity: (active: boolean) => void; onComplete: (session: InterviewSession) => void
}) {
  const [config, setConfig] = useState<InterviewConfig>(DEFAULT_CONFIG)
  const [started, setStarted] = useState(false)
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const [question, setQuestion] = useState<string | null>(null)
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dictating, setDictating] = useState(false)
  const [dictationBusy, setDictationBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const microphone = useInterviewRecorder()
  const controller = useRef<AbortController | null>(null)
  const operation = useRef(0)
  const lock = useRef(false)
  const micLock = useRef(false)
  const identity = useRef({ id: '', startedAt: 0 })

  useEffect(() => () => { operation.current += 1; controller.current?.abort() }, [])
  useEffect(() => {
    if (!started) return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - identity.current.startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [started])

  async function askNext(history: InterviewTurn[], settings: InterviewConfig) {
    const token = ++operation.current
    const abort = new AbortController()
    controller.current?.abort()
    controller.current = abort
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      const next = await requestInterview({ action: 'question', config: settings, turns: history }, abort.signal)
      if (operation.current !== token) return
      setQuestion(next)
    } catch (e) {
      if (!abort.signal.aborted && operation.current === token) setError(e instanceof Error ? e.message : 'Could not load the next question. Retry without losing your answers.')
    } finally {
      if (operation.current === token) { lock.current = false; setBusy(false); controller.current = null }
    }
  }
  function begin() {
    if (lock.current || started || blocked || !config.role.trim()) return
    identity.current = { id: crypto.randomUUID(), startedAt: Date.now() }
    setElapsed(0)
    setTurns([])
    setQuestion(null)
    setAnswer('')
    setStarted(true)
    onActivity(true)
    void askNext([], config)
  }
  function cancelQuestion() {
    operation.current += 1
    controller.current?.abort()
    controller.current = null
    lock.current = false
    setBusy(false)
  }
  function complete(history: InterviewTurn[]) {
    cancelQuestion()
    if (history.length === 0) {
      setStarted(false)
      onActivity(false)
      setQuestion(null)
      setAnswer('')
      return
    }
    try {
      onComplete({
        id: identity.current.id, kind: 'mock', title: `${config.round} mock — ${config.role}`.slice(0, 200),
        createdAt: identity.current.startedAt,
        durationSeconds: Math.max(0, Math.round((Date.now() - identity.current.startedAt) / 1000)),
        transcript: mockTranscript(history), turns: history,
        captureNote: `Mock interview for ${config.level} ${config.role}; ${config.round} round. ${history.length} of ${config.questionCount} planned questions answered. Interviewer questions are AI-generated; only text explicitly submitted under Candidate is the candidate's answer. Dictated text may contain ASR errors. No code was executed as part of this mock.`,
      })
      setStarted(false)
      onActivity(false)
      setQuestion(null)
      setAnswer('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this mock. Export your answers before leaving.') }
  }
  function submit() {
    if (lock.current || !question || !answer.trim() || dictating || dictationBusy) return
    const nextTurns = [...turns, { question, answer: answer.trim() }]
    setTurns(nextTurns)
    setQuestion(null)
    setAnswer('')
    if (nextTurns.length >= config.questionCount) complete(nextTurns)
    else void askNext(nextTurns, config)
  }
  function finishEarly() {
    if (dictating || dictationBusy) return
    const submitted = question && answer.trim() ? [...turns, { question, answer: answer.trim() }] : turns
    setTurns(submitted)
    complete(submitted)
  }
  async function toggleDictation() {
    if (micLock.current) return
    micLock.current = true
    setDictationBusy(true)
    setError(null)
    try {
      if (dictating) {
        const rows = await microphone.stop()
        const spoken = captureText(rows)
        setAnswer((previous) => [previous.trim(), spoken].filter(Boolean).join('\n\n').slice(0, 12_000))
        if (answer.length + spoken.length > 12_000) setError('The answer reached the 12,000-character limit. Review the text; excess dictation was not appended.')
        setDictating(false)
      } else {
        setDictating(true)
        await microphone.start('mic')
      }
    } catch (e) {
      await microphone.stop()
      setDictating(false)
      setError(e instanceof Error ? e.message : 'Microphone capture failed. You can type your answer instead.')
    } finally { micLock.current = false; setDictationBusy(false) }
  }

  return (
    <section className="reader-surface space-y-5 rounded-2xl p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-[family-name:var(--font-serif)] text-2xl">Mock Interview</h2><p className="mt-2 text-sm text-black/60">An AI interviewer asks one question at a time and follows up on your answers. Coaching appears after you finish.</p></div>{started && <span role="status" className="rounded-full bg-black/5 px-3 py-2 text-sm tabular-nums">{turns.length}/{config.questionCount} answered · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>}</div>
      <fieldset disabled={started} className="grid gap-4 sm:grid-cols-2 disabled:opacity-70">
        <label className="space-y-1 text-sm">Target role<input value={config.role} maxLength={200} onChange={(e) => setConfig({ ...config, role: e.target.value })} className="w-full rounded-xl border border-black/15 bg-transparent p-3" /></label>
        <label className="space-y-1 text-sm">Experience level<select value={config.level} onChange={(e) => setConfig({ ...config, level: e.target.value as InterviewConfig['level'] })} className="w-full rounded-xl border border-black/15 bg-transparent p-3">{(['junior', 'mid', 'senior', 'staff'] as const).map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
        <label className="space-y-1 text-sm">Round<select value={config.round} onChange={(e) => setConfig({ ...config, round: e.target.value as InterviewConfig['round'] })} className="w-full rounded-xl border border-black/15 bg-transparent p-3">{ROUNDS.map((round) => <option key={round} value={round}>{round}</option>)}</select></label>
        <label className="space-y-1 text-sm">Questions<select value={config.questionCount} onChange={(e) => setConfig({ ...config, questionCount: Number(e.target.value) })} className="w-full rounded-xl border border-black/15 bg-transparent p-3">{[3, 5, 8].map((count) => <option key={count} value={count}>{count} questions</option>)}</select></label>
        <label className="space-y-1 text-sm sm:col-span-2">Optional job description / topics to practice<textarea rows={3} maxLength={10_000} value={config.context} onChange={(e) => setConfig({ ...config, context: e.target.value })} className="w-full rounded-xl border border-black/15 bg-transparent p-3" placeholder="Paste role requirements or topics. Do not include secrets or confidential code." /></label>
      </fieldset>
      {!started ? <button className="btn-signal" disabled={blocked || !config.role.trim()} onClick={begin}>Start mock interview</button> : <>
        <div className="rounded-2xl border border-black/10 p-4 sm:p-5" aria-busy={busy}>
          <h3 className="text-sm font-semibold">Question {Math.min(turns.length + 1, config.questionCount)} of {config.questionCount}</h3>
          <p className="mt-3 whitespace-pre-wrap text-lg leading-relaxed" aria-live="polite">{busy ? 'Preparing the next question…' : question ?? 'The next question is not loaded. Retry below.'}</p>
          {busy ? <button className="btn-ghost mt-4" onClick={cancelQuestion}>Cancel question request</button> : !question && turns.length < config.questionCount && <button className="btn-ghost mt-4" onClick={() => void askNext(turns, config)}>Retry next question</button>}
        </div>
        <label className="block space-y-2 text-sm">Your answer<textarea className="w-full rounded-xl border border-black/15 bg-transparent p-3 text-base leading-relaxed" rows={7} maxLength={12_000} disabled={!question || busy || dictating || dictationBusy} value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Explain your approach and reasoning. You can type code here; this mode does not execute it." /></label>
        {dictating && <div className="rounded-xl bg-black/5 p-4"><p className="text-sm font-medium">{dictationBusy ? 'Connecting microphone…' : microphone.phase === 'recording' ? 'Dictating — stop to append this to your answer' : 'Microphone stopped — append captured words below'}</p><p className="mt-2 whitespace-pre-wrap text-sm">{captureText(microphone.segments) || 'Speak your answer.'}</p></div>}
        <div className="flex flex-wrap gap-2">
          <button className="btn-signal gap-2" disabled={busy || !question || !answer.trim() || dictating || dictationBusy} onClick={submit}><Send size={16} />{turns.length + 1 >= config.questionCount ? 'Submit & open feedback' : 'Submit answer'}</button>
          <button className="btn-ghost gap-2" disabled={!question || busy || dictationBusy} onClick={() => void toggleDictation()}>{dictating ? <Square size={16} /> : <Mic size={16} />}{dictating ? 'Stop & append dictation' : 'Dictate answer'}</button>
          <button className="btn-ghost" disabled={dictating || dictationBusy} onClick={finishEarly}>{turns.length || answer.trim() ? 'Finish early & review' : 'End mock'}</button>
          <button className="btn-ghost" disabled={!turns.length && !answer.trim()} onClick={() => downloadInterview('mock-interview-answers', mockTranscript(question && answer.trim() ? [...turns, { question, answer }] : turns))}>Export answers</button>
        </div>
      </>}
      {blocked && !started && <p role="status" className="text-sm">End the live interview before starting a mock.</p>}
      {(error || microphone.error) && <p role="alert" className="text-sm text-[color:var(--stop)]">{error || microphone.error}</p>}
      {turns.length > 0 && <details className="rounded-xl border border-black/10 p-4"><summary className="cursor-pointer text-sm font-medium">Submitted answers ({turns.length})</summary><div className="mt-4 space-y-5">{turns.map((turn, i) => <article key={i}><h4 className="font-medium">{i + 1}. {turn.question}</h4><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/70">{turn.answer}</p></article>)}</div></details>}
    </section>
  )
}
