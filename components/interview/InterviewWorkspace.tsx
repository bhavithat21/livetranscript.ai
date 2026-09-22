'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { usePanelWidth } from '@/lib/copilot/usePanelWidth'
import { useCandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { saveSession } from '@/app/(app)/record/actions'
import { useInterviewCapture, type CaptureSource } from '@/lib/interview/useInterviewCapture'
import {
  DEFAULT_SETTINGS, FOCUSES, LEVELS, MAX_TRANSCRIPT_CHARS, MAX_TURNS,
  formatTime, normalizeFeedback, parseInterviewRequest, reportMarkdown, savedSegments, transcriptText,
  type InterviewFeedback, type InterviewMode, type InterviewSettings, type InterviewTurn,
} from '@/lib/interview/model'
import { FeedbackReport } from './FeedbackReport'

type Phase = 'setup' | 'active' | 'review'
type Session = { mode: InterviewMode; settings: InterviewSettings; startedAt: number; durationMs: number }
const FOCUS_LABELS = { mixed: 'Mixed interview', behavioral: 'Behavioral', coding: 'Coding', systemDesign: 'System design' }
const control = 'min-h-11 w-full rounded-xl border border-current/20 bg-transparent px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--signal)]'
const roleLabel = (role: InterviewTurn['role']) => role === 'candidate' ? 'Candidate' : 'Interviewer'

export function InterviewWorkspace() {
  const [mode, setMode] = useState<InterviewMode>('live')
  const [settings, setSettings] = useState<InterviewSettings>(DEFAULT_SETTINGS)
  const [includeProfile, setIncludeProfile] = useState(false)
  const [source, setSource] = useState<CaptureSource | 'none'>('both')
  const [consent, setConsent] = useState(false)
  const [phase, setPhase] = useState<Phase>('setup')
  const phaseRef = useRef<Phase>('setup')
  const [session, setSession] = useState<Session | null>(null)
  const sessionRef = useRef<Session | null>(null)
  const [turns, setTurns] = useState<InterviewTurn[]>([])
  const turnsRef = useRef<InterviewTurn[]>([])
  const [draft, setDraft] = useState('')
  const [draftRole, setDraftRole] = useState<InterviewTurn['role']>('candidate')
  const [feedback, setFeedback] = useState<InterviewFeedback | null>(null)
  const [busy, setBusy] = useState<'question' | 'feedback' | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const stepRef = useRef(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [copilotOpen, setCopilotOpen] = useState(false)
  const [allowAssistance, setAllowAssistance] = useState(false)
  const [resetConfirm, setResetConfirm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [editRole, setEditRole] = useState<InterviewTurn['role']>('candidate')
  const requestRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)
  const mounted = useRef(true)
  const stopCaptureRef = useRef<(() => Promise<void>) | null>(null)
  const profile = useCandidateProfile()
  const panel = usePanelWidth()

  const append = useCallback((turn: InterviewTurn) => {
    if (phaseRef.current !== 'active') return false
    const next = [...turnsRef.current, turn]
    if (next.length > MAX_TURNS || next.reduce((n, t) => n + t.text.length, 0) > MAX_TRANSCRIPT_CHARS) {
      setError('The session reached its transcript limit. The latest turn was not added. End and export this session before starting another.')
      void stopCaptureRef.current?.()
      return false
    }
    turnsRef.current = next
    setTurns(next)
    return true
  }, [])
  const capture = useInterviewCapture(append)
  useEffect(() => { stopCaptureRef.current = capture.stop }, [capture.stop])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      generationRef.current++
      requestRef.current?.abort()
      window.speechSynthesis?.cancel()
    }
  }, [])
  useEffect(() => {
    if (phase !== 'active' || !session) return
    const timer = window.setInterval(() => setElapsed(Date.now() - session.startedAt), 1000)
    return () => window.clearInterval(timer)
  }, [phase, session])

  const changePhase = (next: Phase) => { phaseRef.current = next; setPhase(next) }
  const cancelAI = () => {
    generationRef.current++
    requestRef.current?.abort()
    requestRef.current = null
    setBusy(null)
  }
  const makeTurn = (role: InterviewTurn['role'], text: string, source: InterviewTurn['source']): InterviewTurn => ({
    id: crypto.randomUUID(), role, text: text.trim(), source,
    atMs: Math.max(0, Date.now() - (sessionRef.current?.startedAt ?? Date.now())),
  })

  async function runAI(action: 'question' | 'feedback', submitted: InterviewTurn[]) {
    const current = sessionRef.current
    if (!current || requestRef.current) return
    let body
    try { body = parseInterviewRequest({ action, mode: current.mode, settings: current.settings, turns: submitted }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Check the interview settings.'); return }
    const controller = new AbortController()
    requestRef.current = controller
    const generation = generationRef.current
    setBusy(action)
    setError(null)
    const timeout = window.setTimeout(() => controller.abort(), 55_000)
    try {
      const response = await fetch('/api/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal,
      })
      const result = await response.json().catch(() => ({ error: response.status === 401 ? 'Sign in to use interview AI.' : 'The server returned an unexpected response. Retry or export your transcript.' })) as { error?: string; question?: string; feedback?: unknown }
      if (!response.ok) throw new Error(result.error || 'Interview AI failed. Retry the request.')
      if (!mounted.current || generation !== generationRef.current || requestRef.current !== controller) return
      if (action === 'question') {
        if (typeof result.question !== 'string' || !result.question.trim()) throw new Error('No question was returned. Retry.')
        append(makeTurn('interviewer', result.question, 'mock'))
        setStatus('Question ready. Answer aloud or type below.')
      } else {
        setFeedback(normalizeFeedback(result.feedback, submitted))
        setSavedId(null)
        setStatus('Feedback ready. Save to Library or export your report.')
      }
    } catch (e) {
      if (mounted.current && generation === generationRef.current && requestRef.current === controller) {
        setError(controller.signal.aborted ? 'The request timed out. Your transcript is preserved; retry when ready.' : e instanceof Error ? e.message : 'Interview AI is unavailable. Retry or export your transcript.')
      }
    } finally {
      window.clearTimeout(timeout)
      if (requestRef.current === controller) {
        requestRef.current = null
        if (mounted.current) setBusy(null)
      }
    }
  }

  async function startSession() {
    if (phaseRef.current !== 'setup') return
    const background = [settings.background, includeProfile ? profile.contextBlock() : ''].filter(Boolean).join('\n\n')
    const configured = { ...settings, background }
    try { parseInterviewRequest({ action: 'question', mode: 'mock', settings: configured, turns: [] }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Check the settings.'); return }
    if (mode === 'live' && source !== 'none' && !consent) { setError('Confirm recording permission before capturing interview audio.'); return }
    const current: Session = { mode, settings: configured, startedAt: Date.now(), durationMs: 0 }
    generationRef.current++
    sessionRef.current = current
    setSession(current)
    turnsRef.current = []
    setTurns([])
    setFeedback(null)
    setSavedId(null)
    setElapsed(0)
    setDraft('')
    setError(null)
    setStatus(mode === 'mock' ? 'Preparing your first question…' : 'Interview started. Capture or add questions and answers below.')
    changePhase('active')
    if (mode === 'mock') await runAI('question', [])
    else if (source !== 'none') await capture.start(source, current.startedAt)
  }

  function addDraft() {
    if (!draft.trim() || phaseRef.current !== 'active') return false
    if (!append(makeTurn(sessionRef.current?.mode === 'mock' ? 'candidate' : draftRole, draft, 'typed'))) return false
    setDraft('')
    return true
  }
  async function nextQuestion() {
    if (stepRef.current || requestRef.current || phaseRef.current !== 'active') return
    stepRef.current = true
    setTransitioning(true)
    const generation = generationRef.current
    try {
      await capture.stop()
      if (!mounted.current || generation !== generationRef.current || phaseRef.current !== 'active') return
      if (draft.trim() && !addDraft()) return
      window.speechSynthesis?.cancel()
      await runAI('question', turnsRef.current)
    } finally {
      stepRef.current = false
      if (mounted.current) setTransitioning(false)
    }
  }
  async function endSession() {
    if (phaseRef.current !== 'active' || status === 'Ending interview…') return
    cancelAI()
    setStatus('Ending interview…')
    window.speechSynthesis?.cancel()
    setCopilotOpen(false)
    await capture.stop()
    if (!mounted.current || phaseRef.current !== 'active') return
    if (draft.trim() && !addDraft()) { setStatus('Shorten or clear your typed draft, then end the interview.'); return }
    const current = sessionRef.current!
    const finished = { ...current, durationMs: Date.now() - current.startedAt }
    sessionRef.current = finished
    setSession(finished)
    setElapsed(finished.durationMs)
    changePhase('review')
    setStatus('Interview ended. Review the transcript and speaker labels, then generate feedback.')
  }
  function readQuestion() {
    const question = turnsRef.current.filter((t) => t.role === 'interviewer').at(-1)
    if (!question) return
    if (!('speechSynthesis' in window)) { setError('Read-aloud is unavailable in this browser. The question is shown as text.'); return }
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(question.text))
    setStatus('Reading the question. Start recording your answer after it finishes.')
  }
  async function toggleCapture() {
    window.speechSynthesis?.cancel()
    if (capture.status !== 'idle') { await capture.stop(); return }
    const current = sessionRef.current
    if (!current || phaseRef.current !== 'active') return
    await capture.start(current.mode === 'mock' ? 'mic' : source === 'none' ? 'mic' : source, current.startedAt)
  }
  async function saveToLibrary() {
    const current = sessionRef.current
    if (!current || !turns.length || savingRef.current || savedId || busy) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const result = await saveSession({
        title: `${current.mode === 'mock' ? 'Mock interview' : 'Live interview'} — ${current.settings.role}`,
        language: 'en', durationSeconds: Math.round(current.durationMs / 1000), segments: savedSegments(turnsRef.current),
        summary: {
          summary: feedback ? reportMarkdown(feedback, turnsRef.current) : 'Interview transcript. AI feedback has not been generated.',
          keyPoints: [`${FOCUS_LABELS[current.settings.focus]} · ${current.settings.level}`, ...(feedback?.dimensions.filter((d) => d.score !== null).map((d) => `${d.key}: ${d.score}/5`) ?? [])],
          actionItems: feedback?.nextSteps ?? [],
        },
      })
      if (mounted.current) { setSavedId(result.id); setStatus('Saved privately to your Library.') }
    } catch {
      if (mounted.current) setError('Could not save to Library. Check sign-in and database configuration, then retry. Export is still available.')
    } finally { savingRef.current = false; if (mounted.current) setSaving(false) }
  }
  function exportSession(kind: 'json' | 'md') {
    const current = sessionRef.current
    if (!current) return
    const contents = kind === 'json'
      ? JSON.stringify({ version: 1, mode: current.mode, settings: { ...current.settings, background: undefined }, startedAt: new Date(current.startedAt).toISOString(), durationMs: current.durationMs || elapsed, turns: turnsRef.current, feedback }, null, 2)
      : `${feedback ? reportMarkdown(feedback, turnsRef.current) : '# Interview transcript'}\n\n## Transcript\n\n${transcriptText(turnsRef.current)}`
    const blob = new Blob([contents], { type: kind === 'json' ? 'application/json' : 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${current.mode}-interview-${new Date(current.startedAt).toISOString().slice(0, 10)}.${kind}`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setStatus('Export requested. The export excludes your resume and job-description background.')
  }
  function applyEdit() {
    if (!editText.trim() || busy || saving) return
    const corrected = turnsRef.current.map((t) => t.id === editingId ? { ...t, text: editText.trim(), role: editRole } : t)
    if (corrected.reduce((n, t) => n + t.text.length, 0) > MAX_TRANSCRIPT_CHARS) { setError('The correction exceeds the transcript size limit. Shorten it and retry.'); return }
    turnsRef.current = corrected
    setTurns(corrected)
    setFeedback(null)
    setSavedId(null)
    setEditingId(null)
    setStatus('Transcript corrected. Regenerate feedback before saving an updated copy.')
  }
  function reset() {
    if (saving || busy || capture.status !== 'idle') return
    cancelAI()
    sessionRef.current = null
    setSession(null)
    turnsRef.current = []
    setTurns([])
    setFeedback(null)
    setDraft('')
    setSavedId(null)
    setConsent(false)
    setAllowAssistance(false)
    setCopilotOpen(false)
    setEditingId(null)
    setResetConfirm(false)
    setStatus('')
    setError(null)
    changePhase('setup')
  }
  const questionCount = turns.filter((t) => t.role === 'interviewer').length
  const lastQuestion = turns.filter((t) => t.role === 'interviewer').at(-1)
  const ending = status === 'Ending interview…'
  const activeMode = session?.mode ?? mode
  const transcriptGetter = useCallback(() => transcriptText(turnsRef.current), [])

  return (
    <main className={`ph-no-capture ph-no-record min-h-screen px-4 pb-16 pt-[max(1rem,var(--titlebar-height,0px))] text-ink sm:px-8 ${copilotOpen ? 'md:pr-[var(--interview-panel-padding)]' : ''}`} style={{ '--interview-panel-padding': `${panel.width + 24}px` } as CSSProperties}>
      <div className="mx-auto max-w-5xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4 pt-3">
          <HomeMenu />
          <Link href="/dashboard" className="btn-ghost text-sm">Interview history in Library</Link>
        </header>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><p className="text-sm">Prepare · interview · improve</p><h1 className="mt-1 font-serif text-3xl sm:text-4xl">Interview studio</h1></div>
          {session && <p className="text-right text-sm"><span className="block font-medium">{activeMode === 'live' ? 'Live interview' : 'Mock interview'} · {phase === 'review' ? 'Ended' : capture.status === 'recording' ? 'Recording' : 'In progress'}</span><span>{formatTime(elapsed)} / {session.settings.minutes}:00 target</span></p>}
        </div>
        <div role="status" aria-live="polite" className="min-h-6 text-sm">{busy === 'question' ? 'Preparing the next question…' : busy === 'feedback' ? 'Reviewing your answers and checking evidence…' : status}</div>
        {(error || capture.error) && <div role="alert" className="reader-surface rounded-xl border border-[color:var(--stop)] p-4 text-sm">{error || capture.error}</div>}

        {phase === 'setup' && <section className="reader-surface space-y-6 rounded-3xl p-5 sm:p-8" aria-label="Interview setup">
          <fieldset><legend className="font-medium">Choose your mode</legend><div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(['live', 'mock'] as const).map((value) => <label key={value} className="flex min-h-24 cursor-pointer items-start gap-3 rounded-2xl border border-current/20 p-4 has-[:checked]:border-[color:var(--signal)]">
              <input type="radio" name="interview-mode" value={value} checked={mode === value} onChange={() => { setMode(value); setError(null) }} className="mt-1" />
              <span><strong className="block">{value === 'live' ? 'Live interview' : 'Mock interview'}</strong><span className="mt-1 block text-sm leading-relaxed">{value === 'live' ? 'Capture your real conversation, label speakers, and review your answers afterward.' : 'Practice with an AI interviewer, answer by voice or text, and get targeted feedback.'}</span></span>
            </label>)}
          </div></fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm"><span className="block font-medium">Target role</span><input className={control} value={settings.role} maxLength={200} onChange={(e) => setSettings({ ...settings, role: e.target.value })} /></label>
            <label className="space-y-2 text-sm"><span className="block font-medium">Seniority</span><select className={control} value={settings.level} onChange={(e) => setSettings({ ...settings, level: e.target.value as InterviewSettings['level'] })}>{LEVELS.map((v) => <option key={v} value={v}>{v[0].toUpperCase() + v.slice(1)}</option>)}</select></label>
            <label className="space-y-2 text-sm"><span className="block font-medium">Interview focus</span><select className={control} value={settings.focus} onChange={(e) => setSettings({ ...settings, focus: e.target.value as InterviewSettings['focus'] })}>{FOCUSES.map((v) => <option key={v} value={v}>{FOCUS_LABELS[v]}</option>)}</select></label>
            <label className="space-y-2 text-sm"><span className="block font-medium">Target duration</span><select className={control} value={settings.minutes} onChange={(e) => setSettings({ ...settings, minutes: Number(e.target.value) })}>{[15, 30, 45, 60].map((v) => <option key={v} value={v}>{v} minutes</option>)}</select></label>
          </div>
          {mode === 'mock' && <label className="block space-y-2 text-sm"><span className="block font-medium">Question limit, including follow-ups</span><select className={control} value={settings.questionCount} onChange={(e) => setSettings({ ...settings, questionCount: Number(e.target.value) })}>{[3, 5, 8, 10].map((v) => <option key={v} value={v}>{v} questions</option>)}</select></label>}
          <label className="block space-y-2 text-sm"><span className="block font-medium">Role details or experience to practice (optional)</span><textarea className={`${control} min-h-28`} maxLength={22000} value={settings.background} onChange={(e) => setSettings({ ...settings, background: e.target.value })} placeholder="Paste relevant job requirements or a project you want to discuss. Do not include secrets." /></label>
          {profile.hasProfile && <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={includeProfile} onChange={(e) => setIncludeProfile(e.target.checked)} />Include my saved resume and job description as AI context</label>}
          {mode === 'live' && <div className="space-y-3">
            <label className="block space-y-2 text-sm"><span className="block font-medium">Audio capture</span><select className={control} value={source} onChange={(e) => setSource(e.target.value as CaptureSource | 'none')}><option value="both">System audio + my microphone (separate speakers)</option><option value="mic">My microphone only (candidate answers)</option><option value="system">System audio only (interviewer)</option><option value="none">No audio — enter the conversation manually</option></select></label>
            <p className="text-sm leading-relaxed">Use headphones for separate tracks. System audio is labeled Interviewer; microphone audio is labeled Candidate. Check these labels before feedback. Browser capture requires sharing audio; native desktop capture is used when available.</p>
            {source !== 'none' && <label className="flex min-h-11 items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>I have permission to capture and process this interview audio.</span></label>}
          </div>}
          <p className="text-sm leading-relaxed">Audio is sent to your configured transcription service. Questions and feedback send the transcript and selected background to the AI service. Sessions stay in this page until you explicitly save or export; leaving or reloading can lose unsaved work. No raw audio is saved by this feature.</p>
          <button type="button" className="btn-signal" onClick={() => void startSession()}>Start {mode === 'live' ? 'live interview' : 'mock interview'}</button>
        </section>}

        {phase === 'active' && session && <>
          <section className="glass flex flex-wrap items-center gap-3 rounded-2xl p-4" aria-label="Interview controls">
            <button type="button" className="btn-ghost" onClick={() => void toggleCapture()} disabled={ending || (activeMode === 'mock' && !!busy) || (activeMode === 'live' && source === 'none')}>{capture.status === 'starting' ? 'Cancel audio startup' : capture.status === 'stopping' ? 'Stopping audio…' : capture.status === 'recording' ? 'Stop audio' : activeMode === 'mock' ? 'Record my answer' : 'Start audio'}</button>
            {capture.status === 'recording' && <span className="text-sm">Recording · Mic {Math.round(capture.levels.candidate * 100)} · System {Math.round(capture.levels.interviewer * 100)}</span>}
            <button type="button" className="btn-stop ml-auto" onClick={() => void endSession()} disabled={ending}>End interview</button>
            {elapsed >= session.settings.minutes * 60_000 && <p className="w-full text-sm">Your target duration has been reached. End when ready; recording does not stop automatically.</p>}
          </section>
          {activeMode === 'mock' && <section className="reader-surface rounded-2xl p-5 sm:p-6" aria-label="Current mock question">
            <p className="text-sm">Question {questionCount} of {session.settings.questionCount} · {FOCUS_LABELS[session.settings.focus]}</p>
            <h2 className="mt-3 whitespace-pre-wrap font-serif text-2xl leading-relaxed">{lastQuestion?.text || 'Your first question will appear here.'}</h2>
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className="btn-ghost text-sm" onClick={readQuestion} disabled={!lastQuestion || capture.status !== 'idle' || ending}>Read question aloud</button>
              <button type="button" className="btn-signal text-sm" onClick={() => void nextQuestion()} disabled={!!busy || transitioning || ending || questionCount >= session.settings.questionCount}>{questionCount === 0 ? 'Retry first question' : 'Finish answer & next question'}</button>
            </div>
            {questionCount >= session.settings.questionCount && <p className="mt-3 text-sm">This is your final question. Answer it, then end the interview for feedback.</p>}
          </section>}
          {activeMode === 'live' && <section className="glass space-y-3 rounded-2xl p-4" aria-label="Optional live assistance">
            <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={allowAssistance} onChange={(e) => { setAllowAssistance(e.target.checked); if (!e.target.checked) setCopilotOpen(false) }} />AI assistance is permitted for this interview</label>
            <button type="button" className="btn-ghost text-sm" disabled={!allowAssistance || ending} onClick={() => setCopilotOpen((v) => !v)}>{copilotOpen ? 'Close AI copilot' : 'Open AI copilot'}</button>
            <p className="text-sm">Copilot suggestions are not candidate answers and are not included in feedback unless you actually say or enter them.</p>
          </section>}
          <section className="reader-surface space-y-3 rounded-2xl p-5" aria-label="Add interview turn">
            <div className="flex flex-wrap items-center gap-3"><label className="text-sm font-medium" htmlFor="interview-draft">{activeMode === 'mock' ? 'Your answer' : 'Add a transcript turn'}</label>{activeMode === 'live' && <select aria-label="Speaker for typed turn" className={`${control} !w-auto`} value={draftRole} onChange={(e) => setDraftRole(e.target.value as InterviewTurn['role'])}><option value="candidate">Candidate</option><option value="interviewer">Interviewer</option></select>}</div>
            <textarea id="interview-draft" className={`${control} min-h-32`} value={draft} maxLength={10000} onChange={(e) => setDraft(e.target.value)} disabled={ending || !!busy || transitioning} placeholder="Type your answer or paste code. Add it to the transcript when ready." />
            <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-ghost text-sm" onClick={addDraft} disabled={!draft.trim() || !!busy || transitioning || ending}>Add to transcript</button><p className="text-xs">Next question and End interview also include your typed draft.</p></div>
          </section>
        </>}

        {phase === 'review' && <section className="glass space-y-4 rounded-2xl p-5" aria-label="Review actions">
          <p className="text-sm">Confirm speaker labels and correct transcription errors before scoring. Editing clears the current report; previously saved Library entries remain unchanged.</p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className="btn-signal" onClick={() => void runAI('feedback', turnsRef.current)} disabled={!!busy || saving || !!editingId || !turns.some((t) => t.role === 'candidate')}>{feedback ? 'Regenerate feedback' : 'Generate interview feedback'}</button>
            {busy && <button type="button" className="btn-ghost" onClick={() => { cancelAI(); setStatus('Feedback request cancelled. Your transcript is unchanged.') }}>Cancel request</button>}
            <button type="button" className="btn-ghost" onClick={() => void saveToLibrary()} disabled={saving || !!busy || !!savedId || !turns.length || !!editingId}>{saving ? 'Saving…' : savedId ? 'Saved to Library' : 'Save to Library'}</button>
            <button type="button" className="btn-ghost" onClick={() => exportSession('md')} disabled={!turns.length}>Export report</button>
            <button type="button" className="btn-ghost" onClick={() => exportSession('json')} disabled={!turns.length}>Export JSON</button>
            <button type="button" className="btn-ghost" onClick={() => setResetConfirm(true)} disabled={saving || !!busy}>New interview</button>
          </div>
          {savedId && <Link href={`/session/${savedId}`} className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Open saved interview and feedback</Link>}
          {resetConfirm && <div className="reader-surface space-y-3 rounded-xl p-4"><p className="text-sm">Starting another interview clears this page. Save or export any work you need first.</p><div className="flex flex-wrap gap-3"><button type="button" className="btn-signal" onClick={reset}>Start another interview</button><button type="button" className="btn-ghost" onClick={() => setResetConfirm(false)}>Keep reviewing</button></div></div>}
        </section>}
        {feedback && <FeedbackReport report={feedback} turns={turns} />}
        {phase !== 'setup' && <section className="reader-surface rounded-2xl p-5 sm:p-6" aria-labelledby="interview-transcript-heading">
          <h2 id="interview-transcript-heading" className="font-serif text-2xl">Transcript</h2>
          <p className="mt-2 text-xs">{turns.length} captured turns · Audio timestamps show receipt time, not word-level timing.</p>
          {!turns.length && <p className="py-6 text-sm">No transcript yet. Start audio or add a typed turn. Feedback requires candidate answers.</p>}
          <ol className="mt-4 space-y-4">
            {turns.map((turn) => <li id={`turn-${turn.id}`} key={turn.id} className="scroll-mt-6 rounded-xl border border-current/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-medium">{roleLabel(turn.role)} · {formatTime(turn.atMs)} · {turn.source}</p>{phase === 'review' && <button type="button" className="btn-ghost text-xs" disabled={!!busy || saving} onClick={() => { setEditingId(turn.id); setEditText(turn.text); setEditRole(turn.role) }}>Edit turn</button>}</div>
              {editingId === turn.id ? <div className="mt-3 space-y-3"><label className="block text-sm">Speaker<select className={control} value={editRole} onChange={(e) => setEditRole(e.target.value as InterviewTurn['role'])}><option value="candidate">Candidate</option><option value="interviewer">Interviewer</option></select></label><label className="block text-sm">Corrected text<textarea className={`${control} min-h-28`} value={editText} maxLength={10000} onChange={(e) => setEditText(e.target.value)} /></label><div className="flex flex-wrap gap-3"><button type="button" className="btn-signal text-sm" disabled={!editText.trim()} onClick={applyEdit}>Apply correction</button><button type="button" className="btn-ghost text-sm" onClick={() => setEditingId(null)}>Cancel edit</button></div></div> : <p className="mt-3 whitespace-pre-wrap break-words leading-relaxed">{turn.text}</p>}
            </li>)}
          </ol>
          {phase === 'active' && (['interviewer', 'candidate'] as const).map((role) => capture.partial[role] && <p key={role} className="mt-3 text-sm italic">{roleLabel(role)} (transcribing): {capture.partial[role]}</p>)}
        </section>}
      </div>
      {copilotOpen && phase === 'active' && activeMode === 'live' && <CopilotPanel getTranscript={transcriptGetter} onClose={() => setCopilotOpen(false)} width={panel.width} onResizeStart={panel.onResizeStart} />}
    </main>
  )
}
