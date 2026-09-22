'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Download, Mic, Square, Volume2 } from 'lucide-react'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useCandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { useCopilotCapture } from '@/lib/copilot/useCopilotCapture'
import { AnswerClock, deliveryMetrics, practiceReportText } from '@/lib/practice/metrics'
import { usePractice } from '@/lib/practice/usePractice'
import { MAX_PRACTICE_TURNS, PRACTICE_KINDS, PRACTICE_LABELS, type DeliveryMetrics, type PracticeKind, type PracticeTurn } from '@/lib/practice/types'

const FIELD = 'w-full rounded-2xl border border-ink/20 bg-paper px-4 py-3 text-sm text-ink disabled:opacity-60'

function Delivery({ metrics }: { metrics: DeliveryMetrics }) {
  return <div className="mt-5 border-t border-ink/10 pt-4 text-sm text-ink/75">
    <p>{metrics.source === 'microphone' ? 'Microphone transcript' : 'Typed answer'} · {metrics.words} words{metrics.approximateWpm !== null && <> · about {metrics.approximateWpm} words/min</>}</p>
    {metrics.source === 'microphone' && <p className="mt-1 text-xs leading-relaxed">Approximate pace over {(metrics.activeMs / 1000).toFixed(1)} seconds of listening, including pauses. Based on the captured transcript before edits. Transcription can omit fillers; word counts are best suited to space-separated speech.</p>}
    {metrics.fillers.length > 0 ? <p className="mt-2">Phrase counts: {metrics.fillers.map((item) => `${item.phrase} ×${item.count}`).join(' · ')}. Words such as “like” can be meaningful, so these counts are prompts for reflection, not errors.</p> : <p className="mt-2">No tracked English filler phrases were found in this text.</p>}
  </div>
}

function TurnFeedback({ turn, number }: { turn: PracticeTurn; number: number }) {
  return <section aria-label={`Feedback for answer ${number}`} className="space-y-5">
    <p className="text-sm leading-relaxed text-ink/80">{turn.feedback.summary}</p>
    <div className="divide-y divide-ink/10">
      {turn.feedback.rubric.map((item, index) => <div key={`${item.criterion}-${index}`} className="py-4 first:pt-0">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">{item.criterion}</h3>
          <span className="text-xs text-ink/65">{item.score === null ? 'Not enough evidence' : `${item.score}/5 · AI estimate`}</span>
        </div>
        {item.evidence ? <blockquote className="mt-2 border-l-2 border-signal/40 pl-3 text-sm leading-relaxed text-ink/75">“{item.evidence}”</blockquote> : <p className="mt-2 text-sm text-ink/65">No supporting passage identified.</p>}
        <p className="mt-2 text-sm leading-relaxed">{item.suggestion}</p>
      </div>)}
    </div>
    <p className="text-sm leading-relaxed"><span className="font-semibold">Keep: </span>{turn.feedback.strength}</p>
    <p className="text-sm leading-relaxed"><span className="font-semibold">Try next: </span>{turn.feedback.nextStep}</p>
    <Delivery metrics={turn.metrics} />
  </section>
}

export function PracticeWorkspace() {
  const practice = usePractice()
  const profile = useCandidateProfile()
  const capture = useCopilotCapture()
  const { session, busy, error } = practice
  const [role, setRole] = useState('Software engineer')
  const [kind, setKind] = useState<PracticeKind>('behavioral')
  const [context, setContext] = useState('')
  const [includeProfile, setIncludeProfile] = useState(true)
  const [answer, setAnswer] = useState('')
  const [formError, setFormError] = useState('')
  const [voiceAvailable, setVoiceAvailable] = useState(false)
  const [readAloud, setReadAloud] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [dictating, setDictating] = useState(false)
  const [dictationBase, setDictationBase] = useState('')
  const [hasDictation, setHasDictation] = useState(false)
  const [exportNotice, setExportNotice] = useState('')
  const [speechError, setSpeechError] = useState('')
  const roleInput = useRef<HTMLInputElement>(null)
  const answerInput = useRef<HTMLTextAreaElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const voiceRun = useRef<{ base: string } | null>(null)
  const spoken = useRef<string[]>([])
  const clock = useRef(new AnswerClock())
  const previousCapture = useRef(capture.status)
  const lastSpokenQuestion = useRef('')
  const speechGeneration = useRef(0)
  const liveText = capture.segments.map((segment) => segment.text).join(' ').trim()
  const displayedAnswer = dictating ? [dictationBase, liveText].filter(Boolean).join('\n\n') : answer
  const phase = session?.phase
  const currentQuestion = session?.question

  const stopSpeaking = useCallback(() => {
    speechGeneration.current++
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
    setSpeaking(false)
  }, [])

  const speak = useCallback((question: string) => {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return
    stopSpeaking()
    setSpeechError('')
    const generation = speechGeneration.current
    const utterance = new SpeechSynthesisUtterance(question)
    utterance.onend = () => { if (generation === speechGeneration.current) setSpeaking(false) }
    utterance.onerror = () => {
      if (generation === speechGeneration.current) { setSpeaking(false); setSpeechError('Voice playback is unavailable. You can read the question above.') }
    }
    try { window.speechSynthesis.speak(utterance); setSpeaking(true) }
    catch { setSpeaking(false); setSpeechError('Voice playback is unavailable. You can read the question above.') }
  }, [stopSpeaking])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active) setVoiceAvailable('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) })
    const stopVoice = () => { speechGeneration.current++; if ('speechSynthesis' in window) window.speechSynthesis.cancel() }
    window.addEventListener('pagehide', stopVoice)
    return () => { active = false; window.removeEventListener('pagehide', stopVoice); stopVoice() }
  }, [])

  useEffect(() => {
    if (!phase) return
    let active = true
    heading.current?.focus()
    if (phase === 'answering' && currentQuestion && readAloud && lastSpokenQuestion.current !== currentQuestion) {
      queueMicrotask(() => {
        if (active) { lastSpokenQuestion.current = currentQuestion; speak(currentQuestion) }
      })
    }
    return () => { active = false }
  }, [phase, currentQuestion, readAloud, speak])

  const finishDictation = useCallback(() => {
    const run = voiceRun.current
    if (!run) return
    clock.current.pause(performance.now())
    voiceRun.current = null
    if (liveText) { spoken.current.push(liveText); setHasDictation(true) }
    setAnswer([run.base, liveText].filter(Boolean).join('\n\n'))
    setDictating(false)
  }, [liveText])

  useEffect(() => {
    const previous = previousCapture.current
    previousCapture.current = capture.status
    if (!voiceRun.current) return
    if (capture.status === 'listening') clock.current.start(performance.now())
    else clock.current.pause(performance.now())
    if (capture.status === 'error' || ((previous === 'starting' || previous === 'listening') && capture.status === 'idle')) {
      queueMicrotask(finishDictation)
    }
  }, [capture.status, finishDictation])

  function clearAnswer() {
    capture.stop()
    capture.clear()
    voiceRun.current = null
    spoken.current = []
    lastSpokenQuestion.current = ''
    clock.current.reset()
    setDictating(false)
    setDictationBase('')
    setHasDictation(false)
    setAnswer('')
    setFormError('')
  }

  async function begin(event: React.FormEvent) {
    event.preventDefault()
    if (!role.trim()) { setFormError('Enter the role you want to practice.'); roleInput.current?.focus(); return }
    setFormError('')
    setExportNotice('')
    const grounding = [includeProfile ? profile.contextBlock() : null, context.trim() ? `PRACTICE FOCUS:\n${context.trim()}` : ''].filter(Boolean).join('\n\n')
    await practice.start({ role: role.trim(), kind, context: grounding })
  }

  async function record() {
    if (voiceRun.current || busy) return
    stopSpeaking()
    capture.clear()
    voiceRun.current = { base: answer }
    setDictationBase(answer)
    setDictating(true)
    setFormError('')
    await capture.start('mic')
  }

  function stopRecording() {
    finishDictation()
    capture.stop()
    queueMicrotask(() => answerInput.current?.focus())
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (dictating || busy) return
    if (!answer.trim()) { setFormError('Type an answer or use your microphone first.'); answerInput.current?.focus(); return }
    if (answer.length > 6_000) { setFormError('Shorten this answer to 6,000 characters before submitting.'); answerInput.current?.focus(); return }
    setFormError('')
    stopSpeaking()
    const speech = spoken.current.join(' ')
    const metrics = deliveryMetrics(speech || answer, clock.current.elapsed(performance.now()), speech ? 'microphone' : 'typed')
    if (await practice.submit(answer, metrics)) clearAnswer()
  }

  async function finish() {
    if (dictating) stopRecording()
    stopSpeaking()
    await practice.finish()
  }

  function exportReport() {
    if (!session) return
    try {
      const url = URL.createObjectURL(new Blob([practiceReportText(session)], { type: 'text/plain;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'practice-interview-review.txt'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1_000)
      setExportNotice('Review download requested. A copy includes your answers; keep it somewhere private.')
    } catch { setExportNotice('The download could not start. Your review remains below so you can select and copy it.') }
  }

  return <main className="min-h-screen px-4 py-5 text-ink sm:px-8">
    <div className="mx-auto max-w-5xl">
      <header className="mb-9 flex flex-wrap items-center justify-between gap-4">
        <HomeMenu />
        <div className="flex items-center gap-3"><Link href="/copilot" className="btn-ghost min-h-11 text-sm">AI Copilot</Link><ThemeToggle /></div>
      </header>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-signal">Rehearse · reflect · repeat</p><h1 className="font-serif text-3xl sm:text-4xl">Practice interview</h1></div>
        <p className="max-w-sm text-sm leading-relaxed text-ink/70">One question at a time, then feedback tied to your answer. No meeting or second person required.</p>
      </div>

      {!session ? <form onSubmit={begin} noValidate className="reader-surface max-w-2xl rounded-3xl p-5 sm:p-7" aria-label="Practice setup">
        <h2 className="font-serif text-xl">What are you preparing for?</h2>
        <div className="mt-6 space-y-5">
          <div><label htmlFor="practice-role" className="mb-2 block text-sm font-medium">Target role</label><input ref={roleInput} id="practice-role" className={FIELD} maxLength={120} value={role} disabled={!!busy} aria-invalid={!!formError} aria-describedby={formError ? 'practice-form-error' : undefined} onChange={(event) => { setRole(event.target.value); setFormError('') }} /></div>
          <div><label htmlFor="practice-kind" className="mb-2 block text-sm font-medium">Interview type</label><select id="practice-kind" className={FIELD} value={kind} disabled={!!busy} onChange={(event) => setKind(event.target.value as PracticeKind)}>{PRACTICE_KINDS.map((value) => <option key={value} value={value}>{PRACTICE_LABELS[value]}</option>)}</select></div>
          <div><label htmlFor="practice-context" className="mb-2 block text-sm font-medium">Practice focus <span className="font-normal text-ink/65">(optional)</span></label><textarea id="practice-context" className={`${FIELD} resize-none`} rows={3} maxLength={4_000} value={context} disabled={!!busy} placeholder="For example: ownership, handling disagreement, and explaining technical tradeoffs." onChange={(event) => setContext(event.target.value)} /></div>
          <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed"><input className="mt-1 accent-signal" type="checkbox" checked={includeProfile} disabled={!!busy} onChange={(event) => setIncludeProfile(event.target.checked)} /><span>Use saved resume and job description<br /><span className="text-xs text-ink/65">{profile.hasProfile ? 'The profile saved on this device will help tailor the questions.' : 'No profile is saved on this device. Add one in AI Copilot, or practice from the role above.'}</span></span></label>
          <label className="flex min-h-11 items-center gap-3 text-sm"><input className="accent-signal" type="checkbox" checked={readAloud} disabled={!voiceAvailable || !!busy} onChange={(event) => setReadAloud(event.target.checked)} />{voiceAvailable ? 'Read interviewer questions aloud' : 'Question playback is unavailable in this browser'}</label>
          <p className="text-xs leading-relaxed text-ink/65">Questions, context and submitted answers go to the configured AI provider. The session stays in this tab until you download it or leave. The microphone starts only when you choose it.</p>
          <button className="btn-signal min-h-11" disabled={!!busy} type="submit">{busy === 'start' ? 'Preparing your first question…' : 'Start practice'}{!busy && <ArrowRight size={16} aria-hidden="true" />}</button>
        </div>
      </form> : <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="reader-surface min-w-0 rounded-3xl p-5 sm:p-7">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs text-ink/65"><span>{PRACTICE_LABELS[session.kind]} · {session.role}</span><span>{session.phase === 'answering' ? `Question ${session.turns.length + 1} of ${MAX_PRACTICE_TURNS}` : `${session.turns.length} answer${session.turns.length === 1 ? '' : 's'} reviewed`}</span></div>
          {session.phase === 'answering' && <>
            <p className="mb-2 text-xs font-semibold text-signal">{session.focus}</p>
            <h2 ref={heading} tabIndex={-1} className="font-serif text-2xl leading-snug outline-none">{session.question}</h2>
            {voiceAvailable && <button type="button" className="btn-ghost mt-3 min-h-11 text-sm" disabled={dictating || !!busy} onClick={() => speaking ? stopSpeaking() : speak(session.question)}>{speaking ? <Square size={15} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}{speaking ? 'Stop playback' : 'Read question aloud'}</button>}
            <form className="mt-6 space-y-4" onSubmit={submit} noValidate>
              <label htmlFor="practice-answer" className="block text-sm font-medium">Your answer</label>
              <textarea ref={answerInput} id="practice-answer" className={`${FIELD} min-h-48 resize-none leading-relaxed`} rows={8} maxLength={6_000} value={displayedAnswer} readOnly={dictating} disabled={!!busy} aria-invalid={!!formError} aria-describedby={`practice-answer-help${formError ? ' practice-form-error' : ''}`} placeholder="Explain your thinking in your own words. You can type, or dictate and review before submitting." onChange={(event) => { setAnswer(event.target.value); setFormError('') }} />
              <p id="practice-answer-help" className="text-xs leading-relaxed text-ink/65">{dictating ? 'Listening to your microphone. Stop to edit the transcript before submitting.' : 'Edit freely before submitting. No answer is sent to the coach automatically.'} {Math.min(displayedAnswer.length, 6_000).toLocaleString()}/6,000 characters.</p>
              {displayedAnswer.length > 6_000 && <p role="status" className="text-sm text-stop">This answer is too long. Stop dictation and shorten it before submitting.</p>}
              <div className="flex flex-wrap gap-3">
                {dictating ? <button className="btn-stop min-h-11" type="button" onClick={stopRecording}><Square size={15} aria-hidden="true" />{capture.status === 'starting' ? 'Cancel microphone' : 'Stop and review'}</button> : <button className="btn-ghost min-h-11" type="button" disabled={!!busy} onClick={() => void record()}><Mic size={17} aria-hidden="true" />Use microphone</button>}
                <button className="btn-signal min-h-11" type="submit" disabled={dictating || !!busy}>{busy === 'answer' ? 'Reviewing your answer…' : 'Get feedback'}{!busy && <ArrowRight size={16} aria-hidden="true" />}</button>
              </div>
              <p role="status" className="min-h-5 text-xs text-ink/65">{dictating ? capture.status === 'starting' ? 'Waiting for microphone permission and transcription…' : 'Microphone active · stop whenever you are ready' : hasDictation ? 'Microphone stopped. Review the transcript above.' : 'Microphone off'}</p>
            </form>
          </>}
          {session.phase === 'feedback' && <>
            <h2 ref={heading} tabIndex={-1} className="mb-2 font-serif text-2xl">A closer look at your answer</h2>
            <p className="mb-6 text-xs leading-relaxed text-ink/65">These are AI coaching estimates. They are not a validated assessment, and code has not been executed.</p>
            <TurnFeedback turn={session.turns[session.turns.length - 1]} number={session.turns.length} />
            <div className="mt-7 flex flex-wrap gap-3">{session.question && <button className="btn-signal min-h-11" type="button" disabled={!!busy} onClick={() => { clearAnswer(); practice.next() }}>Next question<ArrowRight size={16} aria-hidden="true" /></button>}<button className={`${session.question ? 'btn-ghost' : 'btn-signal'} min-h-11`} type="button" disabled={!!busy} onClick={() => void finish()}>{busy === 'report' ? 'Preparing your review…' : 'Finish and review'}</button></div>
          </>}
          {session.phase === 'report' && session.report && <>
            <h2 ref={heading} tabIndex={-1} className="font-serif text-2xl">Your practice review</h2>
            <p className="mt-4 text-sm leading-relaxed">{session.report.summary}</p>
            <div className="mt-6 space-y-5">{session.report.highlights.map((item, index) => <div key={`${item.turn}-${index}`}><p className="text-xs font-semibold text-signal">Question {item.turn}</p><blockquote className="mt-2 border-l-2 border-signal/40 pl-3 text-sm leading-relaxed">“{item.quote}”</blockquote><p className="mt-2 text-sm leading-relaxed text-ink/75">{item.observation}</p></div>)}</div>
            <h3 className="mb-3 mt-7 font-semibold">Practice next</h3>
            <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed">{session.report.practiceNext.map((item, index) => <li key={index}>{item}</li>)}</ul>
            <p className="mt-6 text-xs leading-relaxed text-ink/65">AI coaching, not a verified hiring or technical assessment. Review the evidence and use your own judgment.</p>
            <div className="mt-6 flex flex-wrap gap-3"><button className="btn-signal min-h-11" type="button" onClick={exportReport}><Download size={16} aria-hidden="true" />Download review</button><button className="btn-ghost min-h-11" type="button" onClick={() => { stopSpeaking(); clearAnswer(); practice.reset() }}>New practice</button></div>
          </>}
          {session.turns.length > 0 && <details className="mt-7 border-t border-ink/10 pt-5"><summary className="min-h-11 cursor-pointer text-sm font-medium">Questions and your answers ({session.turns.length})</summary><div className="mt-3 space-y-7">{session.turns.map((turn, index) => <article key={index}><h3 className="text-sm font-semibold">{index + 1}. {turn.question}</h3><p className="my-3 whitespace-pre-wrap text-sm leading-relaxed text-ink/75">{turn.answer}</p>{session.phase === 'report' && <TurnFeedback turn={turn} number={index + 1} />}</article>)}</div></details>}
        </div>
        <aside aria-label="Practice session" className="space-y-5 text-sm lg:sticky lg:top-6">
          <div className="border-b border-ink/15 pb-5"><h2 className="font-semibold">A useful rehearsal</h2><p className="mt-2 leading-relaxed text-ink/70">Take a moment to think. Explain assumptions, decisions and tradeoffs. The next question adapts to what you actually said.</p></div>
          <div><p className="font-medium">This tab only</p><p className="mt-2 leading-relaxed text-ink/70">Your answers and feedback are not added to meeting history. Download your review before leaving.</p></div>
          {session.phase === 'answering' && session.turns.length > 0 && <button type="button" className="btn-ghost min-h-11 w-full" disabled={!!busy || dictating} onClick={() => void finish()}>Review {session.turns.length} completed answer{session.turns.length === 1 ? '' : 's'}</button>}
          {session.phase !== 'report' && <button type="button" className="btn-ghost min-h-11 w-full" onClick={() => { stopSpeaking(); clearAnswer(); practice.reset() }}>{session.turns.length ? 'Discard this practice' : 'End practice'}</button>}
          <p className="break-words text-xs leading-relaxed text-ink/60">Coach: {session.model}</p>
        </aside>
      </div>}
      {busy && <div className="mt-4 flex flex-wrap items-center gap-3"><p role="status" className="text-sm text-ink/70">{busy === 'start' ? 'Preparing a question…' : busy === 'answer' ? 'Reading your answer…' : 'Reviewing the completed answers…'}</p><button type="button" className="btn-ghost min-h-11 text-sm" onClick={practice.cancel}>Cancel request</button></div>}
      {formError && <p id="practice-form-error" role="alert" className="mt-4 text-sm text-stop">{formError}</p>}
      {(error || capture.error || speechError) && <p role="alert" className="mt-4 text-sm text-stop">{error || capture.error || speechError}</p>}
      {exportNotice && <p role="status" className="mt-4 text-sm text-ink/70">{exportNotice}</p>}
    </div>
  </main>
}
