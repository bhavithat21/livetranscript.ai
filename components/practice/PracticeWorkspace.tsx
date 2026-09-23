'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, Check, Code2, Download, MessageSquareText, MessagesSquare, Mic, Network, Shield, Square, Volume2 } from 'lucide-react'
import { useCandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { useCopilotCapture } from '@/lib/copilot/useCopilotCapture'
import { AnswerClock, deliveryMetrics, practiceReportText } from '@/lib/practice/metrics'
import { usePractice } from '@/lib/practice/usePractice'
import { MAX_PRACTICE_TURNS, PRACTICE_KINDS, PRACTICE_LABELS, type DeliveryMetrics, type PracticeKind, type PracticeTurn } from '@/lib/practice/types'

const FIELD = 'w-full rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--reader)] px-3 py-3 text-sm text-ink disabled:opacity-60'
const PRACTICE_OPTIONS = {
  behavioral: { icon: MessagesSquare, description: 'Ownership, collaboration, and your experience.', placeholder: 'For example: ownership, handling disagreement, and explaining a difficult decision.' },
  coding: { icon: Code2, description: 'Problem solving, algorithms, and reasoning.', placeholder: 'For example: data structures, edge cases, and explaining time complexity.' },
  systemDesign: { icon: Network, description: 'Architecture, scale, and technical tradeoffs.', placeholder: 'For example: event-driven systems, reliability, and capacity planning.' },
  general: { icon: BookOpen, description: 'Fundamentals and knowledge for your role.', placeholder: 'For example: distributed systems fundamentals or the technologies listed in the job description.' },
} as const

function Delivery({ metrics }: { metrics: DeliveryMetrics }) {
  return <div className="mt-5 border-t border-ink/10 pt-4 text-sm text-[color:var(--muted)]">
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
          <span className="text-xs text-[color:var(--muted)]">{item.score === null ? 'Not enough evidence' : `${item.score}/5 · AI estimate`}</span>
        </div>
        {item.evidence ? <blockquote className="mt-2 border-l-2 border-signal/40 pl-3 text-sm leading-relaxed text-[color:var(--muted)]">“{item.evidence}”</blockquote> : <p className="mt-2 text-sm text-[color:var(--muted)]">No supporting passage identified.</p>}
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
  const [confirmReset, setConfirmReset] = useState(false)
  const resetCancel = useRef<HTMLButtonElement>(null)
  const resetTrigger = useRef<HTMLButtonElement | null>(null)
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

  useEffect(() => {
    if (confirmReset) resetCancel.current?.focus()
  }, [confirmReset])

  function requestReset(event: React.MouseEvent<HTMLButtonElement>) {
    resetTrigger.current = event.currentTarget
    setConfirmReset(true)
  }

  function keepPractice() {
    setConfirmReset(false)
    resetTrigger.current?.focus()
  }

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

  return <main className="min-h-screen bg-[color:var(--paper)] text-ink">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--line)] bg-[color:var(--reader)] px-4 py-4 sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--accent-soft)] text-signal"><MessagesSquare size={21} aria-hidden /></span>
        <div><h1 className="text-xl font-semibold tracking-tight">Practice interview</h1><p className="mt-0.5 text-xs text-[color:var(--muted)]">Build confidence with questions and feedback grounded in your answers.</p></div>
      </div>
      <div className="ml-auto flex items-center gap-2"><Link href="/interview#mock" className="btn-ghost min-h-11 text-xs">Test the AI in Mock Lab<ArrowUpRight size={14} aria-hidden /></Link></div>
    </header>
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <ol aria-label="Practice steps" className="mb-6 grid grid-cols-4 gap-2 border-b border-[color:var(--line)] pb-5">
        {['Set up', 'Answer', 'Feedback', 'Review'].map((label, index) => {
          const current = !session ? 0 : session.phase === 'answering' ? 1 : session.phase === 'feedback' ? 2 : 3
          return <li key={label} aria-current={current === index ? 'step' : undefined} className={`flex min-w-0 items-center gap-2 text-xs ${current === index ? 'font-semibold text-signal' : 'text-[color:var(--muted)]'}`}><span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${current === index ? 'border-[color:var(--signal)] bg-[color:var(--accent-soft)]' : 'border-[color:var(--line)]'}`} aria-hidden>{index < current ? <Check size={12} /> : index + 1}</span><span>{label}</span></li>
        })}
      </ol>

      {!session ? <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <form onSubmit={begin} noValidate className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-6" aria-label="Practice setup">
          <div className="mb-6 border-b border-[color:var(--line)] pb-5"><h2 className="text-lg font-semibold">Prepare for your next conversation</h2><p className="mt-1 text-sm text-[color:var(--muted)]">Choose a focus. The coach asks one question at a time.</p></div>
          <div className="space-y-5">
            <div><label htmlFor="practice-role" className="mb-2 block text-sm font-medium">Target role</label><input ref={roleInput} id="practice-role" className={FIELD} maxLength={120} value={role} disabled={!!busy} aria-invalid={!!formError} aria-describedby={formError ? 'practice-form-error' : undefined} onChange={(event) => { setRole(event.target.value); setFormError('') }} /></div>
            <fieldset><legend className="mb-2 text-sm font-medium">Interview type</legend><div className="grid gap-2 sm:grid-cols-2">{PRACTICE_KINDS.map((value) => {
              const option = PRACTICE_OPTIONS[value]
              const Icon = option.icon
              return <button key={value} type="button" disabled={!!busy} aria-pressed={kind === value} onClick={() => setKind(value)} className={`flex min-h-20 items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:opacity-50 ${kind === value ? 'border-[color:var(--signal)] bg-[color:var(--accent-soft)]' : 'border-[color:var(--line)] hover:border-[color:var(--line-strong)] hover:bg-[color:var(--surface-soft)]'}`}><Icon size={18} aria-hidden className={`mt-0.5 shrink-0 ${kind === value ? 'text-signal' : 'text-[color:var(--muted)]'}`} /><span className="min-w-0"><span className="block text-sm font-medium">{PRACTICE_LABELS[value]}</span><span className="mt-1 block text-xs leading-relaxed text-[color:var(--muted)]">{option.description}</span></span>{kind === value && <Check size={14} aria-hidden className="ml-auto shrink-0 text-signal" />}</button>
            })}</div></fieldset>
            <div><label htmlFor="practice-context" className="mb-2 block text-sm font-medium">Practice focus <span className="font-normal text-[color:var(--muted)]">(optional)</span></label><textarea id="practice-context" className={`${FIELD} resize-none`} rows={3} maxLength={4_000} value={context} disabled={!!busy} placeholder={PRACTICE_OPTIONS[kind].placeholder} onChange={(event) => setContext(event.target.value)} /></div>
            <div className="space-y-3 rounded-lg bg-[color:var(--surface-soft)] p-4">
              <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm leading-relaxed"><input className="mt-1 h-4 w-4 shrink-0 accent-signal" type="checkbox" checked={includeProfile} disabled={!!busy} onChange={(event) => setIncludeProfile(event.target.checked)} /><span>Use saved resume and job description<br /><span className="text-xs text-[color:var(--muted)]">{profile.hasProfile ? 'Tailor questions to the profile saved on this device.' : 'No saved profile. You can still practice from the role above.'}</span></span></label>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm"><input className="h-4 w-4 shrink-0 accent-signal" type="checkbox" checked={readAloud} disabled={!voiceAvailable || !!busy} onChange={(event) => setReadAloud(event.target.checked)} /><span>{voiceAvailable ? 'Read interviewer questions aloud' : 'Question playback is unavailable in this browser'}</span></label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[color:var(--line)] pt-5"><p className="max-w-sm text-xs leading-relaxed text-[color:var(--muted)]">Type or use your microphone. You review every answer before sending it.</p><button className="btn-signal min-h-11" disabled={!!busy} type="submit">{busy === 'start' ? 'Preparing your first question…' : 'Start practice'}{!busy && <ArrowRight size={16} aria-hidden />}</button></div>
          </div>
        </form>
        <aside aria-label="How practice works" className="space-y-5">
          <section className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5"><h2 className="text-sm font-semibold">Make each answer count</h2><div className="mt-5 space-y-5">{[
            ['Explain your thinking', 'Talk through the facts, your choices, and what happened next.'],
            ['Get specific feedback', 'See supporting quotes, strengths, and one thing to improve.'],
            ['Try a follow-up', 'Questions adapt to your answers. Stop when you are ready.'],
          ].map(([title, detail]) => <div key={title} className="flex gap-3"><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--signal)]" aria-hidden /><div><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">{detail}</p></div></div>)}</div></section>
          <div className="flex items-start gap-2 px-1"><Shield size={15} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--muted)]" /><p className="text-xs leading-relaxed text-[color:var(--muted)]">Questions, context and submitted answers go to the configured AI provider. Practice stays in this tab; download your review before leaving. Your microphone starts only when you choose it.</p></div>
        </aside>
      </div> : <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-6">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-[color:var(--line)] pb-4 text-xs text-[color:var(--muted)]"><span className="rounded-md bg-[color:var(--surface-soft)] px-2 py-1 font-medium text-ink">{PRACTICE_LABELS[session.kind]}</span><span>{session.phase === 'answering' ? `Question ${session.turns.length + 1} of ${MAX_PRACTICE_TURNS}` : `${session.turns.length} answer${session.turns.length === 1 ? '' : 's'} reviewed`}</span></div>
          {session.phase === 'answering' && <>
            <p className="mb-2 text-xs font-semibold text-signal">{session.focus}</p>
            <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold leading-snug tracking-tight outline-none">{session.question}</h2>
            {voiceAvailable && <button type="button" className="btn-ghost mt-3 min-h-11 text-xs" disabled={dictating || !!busy} onClick={() => speaking ? stopSpeaking() : speak(session.question)}>{speaking ? <Square size={15} aria-hidden /> : <Volume2 size={16} aria-hidden />}{speaking ? 'Stop playback' : 'Read question aloud'}</button>}
            <form className="mt-6 space-y-3" onSubmit={submit} noValidate>
              <label htmlFor="practice-answer" className="block text-sm font-medium">Your answer</label>
              <textarea ref={answerInput} id="practice-answer" className={`${FIELD} min-h-48 resize-none leading-relaxed`} rows={8} maxLength={6_000} value={displayedAnswer} readOnly={dictating} disabled={!!busy} aria-invalid={!!formError} aria-describedby={`practice-answer-help${formError ? ' practice-form-error' : ''}`} placeholder="Explain your thinking in your own words. You can type, or dictate and review before submitting." onChange={(event) => { setAnswer(event.target.value); setFormError('') }} />
              <p id="practice-answer-help" className="text-xs leading-relaxed text-[color:var(--muted)]">{dictating ? 'Listening to your microphone. Stop to edit the transcript before submitting.' : 'Edit freely before submitting. No answer is sent to the coach automatically.'} {Math.min(displayedAnswer.length, 6_000).toLocaleString()}/6,000 characters.</p>
              {displayedAnswer.length > 6_000 && <p role="status" className="text-sm text-stop">This answer is too long. Stop dictation and shorten it before submitting.</p>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--line)] pt-4">
                {dictating ? <button className="btn-stop min-h-11" type="button" onClick={stopRecording}><Square size={15} aria-hidden />{capture.status === 'starting' ? 'Cancel microphone' : 'Stop and review'}</button> : <button className="btn-ghost min-h-11" type="button" disabled={!!busy} onClick={() => void record()}><Mic size={17} aria-hidden />Use microphone</button>}
                <button className="btn-signal min-h-11" type="submit" disabled={dictating || !!busy}>{busy === 'answer' ? 'Reviewing your answer…' : 'Get feedback'}{!busy && <ArrowRight size={16} aria-hidden />}</button>
              </div>
              <p role="status" className="min-h-5 text-xs text-[color:var(--muted)]">{dictating ? capture.status === 'starting' ? 'Waiting for microphone permission and transcription…' : 'Microphone active · stop whenever you are ready' : hasDictation ? 'Microphone stopped. Review the transcript above.' : 'Microphone off'}</p>
            </form>
          </>}
          {session.phase === 'feedback' && <>
            <div className="mb-5 flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--accent-soft)] text-signal"><MessageSquareText size={18} aria-hidden /></span><div><h2 ref={heading} tabIndex={-1} className="text-xl font-semibold tracking-tight outline-none">A closer look at your answer</h2><p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">AI coaching estimates based on your answer. Code has not been executed.</p></div></div>
            <TurnFeedback turn={session.turns[session.turns.length - 1]} number={session.turns.length} />
            <div className="mt-6 flex flex-wrap gap-3 border-t border-[color:var(--line)] pt-5">{session.question && <button className="btn-signal min-h-11" type="button" disabled={!!busy} onClick={() => { clearAnswer(); practice.next() }}>Next question<ArrowRight size={16} aria-hidden /></button>}<button className={`${session.question ? 'btn-ghost' : 'btn-signal'} min-h-11`} type="button" disabled={!!busy} onClick={() => void finish()}>{busy === 'report' ? 'Preparing your review…' : 'Finish and review'}</button></div>
          </>}
          {session.phase === 'report' && session.report && <>
            <h2 ref={heading} tabIndex={-1} className="text-2xl font-semibold tracking-tight outline-none">Your practice review</h2>
            <p className="mt-3 text-sm leading-relaxed">{session.report.summary}</p>
            <div className="mt-6 space-y-4">{session.report.highlights.map((item, index) => <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] p-4" key={`${item.turn}-${index}`}><p className="text-xs font-semibold text-signal">Question {item.turn}</p><blockquote className="mt-2 border-l-2 border-signal/40 pl-3 text-sm leading-relaxed">“{item.quote}”</blockquote><p className="mt-2 text-sm leading-relaxed text-[color:var(--muted)]">{item.observation}</p></div>)}</div>
            <h3 className="mb-3 mt-7 text-sm font-semibold">Practice next</h3>
            <ul className="list-disc space-y-3 pl-5 text-sm leading-relaxed">{session.report.practiceNext.map((item, index) => <li key={index}>{item}</li>)}</ul>
            <p className="mt-5 text-xs leading-relaxed text-[color:var(--muted)]">AI coaching, not a verified hiring or technical assessment. Review the evidence and use your own judgment.</p>
            <div className="mt-6 flex flex-wrap gap-3 border-t border-[color:var(--line)] pt-5"><button className="btn-signal min-h-11" type="button" onClick={exportReport}><Download size={16} aria-hidden />Download review</button><button className="btn-ghost min-h-11" type="button" onClick={requestReset}>New practice</button></div>
          </>}
          {session.turns.length > 0 && <details className="mt-6 border-t border-[color:var(--line)] pt-4"><summary className="min-h-11 cursor-pointer text-sm font-medium hover:text-signal">Questions and your answers ({session.turns.length})</summary><div className="mt-3 space-y-7">{session.turns.map((turn, index) => <article key={index}><h3 className="text-sm font-semibold">{index + 1}. {turn.question}</h3><p className="my-3 whitespace-pre-wrap text-sm leading-relaxed text-[color:var(--muted)]">{turn.answer}</p>{session.phase === 'report' && <TurnFeedback turn={turn} number={index + 1} />}</article>)}</div></details>}
          {confirmReset && <div role="group" aria-label="Confirm practice reset" className="mt-5 rounded-lg border border-[color:var(--line-strong)] bg-[color:var(--surface-soft)] p-4"><h3 className="text-sm font-semibold">Start over?</h3><p className="mt-1 text-sm leading-relaxed text-[color:var(--muted)]">This removes your answers and feedback from this tab. Download your review first to keep a copy.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="btn-ghost min-h-11 text-sm" ref={resetCancel} onClick={keepPractice}>Keep practice</button><button type="button" className="btn-stop min-h-11 text-sm" onClick={() => { stopSpeaking(); clearAnswer(); practice.reset(); setConfirmReset(false) }}>Discard practice</button></div></div>}
        </div>
        <aside aria-label="Practice session" className="space-y-4 text-sm xl:sticky xl:top-6">
          <section className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5"><p className="text-xs font-medium text-[color:var(--muted)]">Your session</p><h2 className="mt-2 font-semibold">{session.role}</h2><div className="mt-5 flex items-end justify-between border-t border-[color:var(--line)] pt-4"><span className="text-xs text-[color:var(--muted)]">Answers reviewed</span><span className="text-2xl font-semibold tabular-nums">{session.turns.length}</span></div><p className="mt-3 text-xs leading-relaxed text-[color:var(--muted)]">Up to {MAX_PRACTICE_TURNS} questions. Finish whenever you are ready.</p></section>
          <div className="px-1"><h2 className="text-sm font-semibold">A useful rehearsal</h2><p className="mt-2 text-xs leading-relaxed text-[color:var(--muted)]">Take a moment to think. Explain assumptions, decisions and tradeoffs. The next question adapts to what you actually said.</p></div>
          <div className="flex gap-2 px-1"><Shield size={15} aria-hidden className="mt-0.5 shrink-0 text-[color:var(--muted)]" /><p className="text-xs leading-relaxed text-[color:var(--muted)]">This tab only. Your answers and feedback are not added to meeting history. Download your review before leaving.</p></div>
          {session.phase === 'answering' && session.turns.length > 0 && <button type="button" className="btn-ghost min-h-11 w-full text-xs" disabled={!!busy || dictating} onClick={() => void finish()}>Review {session.turns.length} completed answer{session.turns.length === 1 ? '' : 's'}</button>}
          {session.phase !== 'report' && <button type="button" className="btn-ghost min-h-11 w-full text-xs" onClick={(event) => { if (session.turns.length || answer || dictating) requestReset(event); else { stopSpeaking(); clearAnswer(); practice.reset() } }}>{session.turns.length ? 'Discard this practice' : 'End practice'}</button>}
          <p className="break-words px-1 text-[11px] leading-relaxed text-[color:var(--muted)]">Coach: {session.model}</p>
        </aside>
      </div>}
      {busy && <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-4 py-2"><p role="status" className="text-sm text-[color:var(--muted)]">{busy === 'start' ? 'Preparing a question…' : busy === 'answer' ? 'Reading your answer…' : 'Reviewing the completed answers…'}</p><button type="button" className="btn-ghost ml-auto min-h-11 text-xs" onClick={practice.cancel}>Cancel request</button></div>}
      {formError && <p id="practice-form-error" role="alert" className="mt-4 rounded-lg border border-stop/20 bg-[color:var(--reader)] px-4 py-3 text-sm text-stop">{formError}</p>}
      {(error || capture.error || speechError) && <p role="alert" className="mt-4 rounded-lg border border-stop/20 bg-[color:var(--reader)] px-4 py-3 text-sm text-stop">{error || capture.error || speechError}</p>}
      {exportNotice && <p role="status" className="mt-4 text-sm text-[color:var(--muted)]">{exportNotice}</p>}
    </div>
  </main>
}
