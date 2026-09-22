'use client'
import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { Check, Eye, EyeOff, FileText, Lock, Monitor, MonitorOff, MoreHorizontal, Play, Send, SlidersHorizontal, Sparkles, Square, X } from 'lucide-react'
import { useLockMode } from '@/lib/desktop/useLockMode'
import { LeverSwitch } from '@/components/ui/LeverSwitch'
import { useAppIdentity } from '@/lib/desktop/useAppIdentity'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { useScreenStream } from '@/lib/vision/useScreenStream'
import type { useModeContext } from '@/lib/copilot/useModeContext'
import { useModeContexts } from '@/lib/copilot/useModeContexts'
import { useCandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { useOrchestrationRouter } from '@/lib/copilot/useOrchestrationRouter'
import { latencyStats } from '@/lib/copilot/latency'
import { useProactive, latestQuestion } from '@/lib/copilot/useProactive'
import { useAnswerFeed } from '@/lib/copilot/useAnswerFeed'
import { useMeContext } from '@/lib/copilot/useMeContext'
import { ChevronDown, ChevronLeft, ChevronRight, Mic, MicOff } from 'lucide-react'
import { MODE_ORDER, MODE_PROFILES, type CopilotMode } from '@/lib/copilot/modes'
import {
  extractCode,
  extractTests,
  executeCode,
  executeTests,
  canExecute,
  isRemoteLanguage,
  preloadRuntime,
  type TestRunResult,
} from '@/lib/copilot/codeExecutor'
import { type RunResult } from '@/lib/copilot/pyodideRunner'
import { useAutoCapture } from '@/lib/vision/useAutoCapture'
import { useOrchestrator, type OrchestratorStage, type ExtractedProblem } from '@/lib/copilot/useOrchestrator'
import { Markdown } from './Markdown'
import { parseDraftStream } from '@/lib/copilot/draftProtocol'
import { splitAnswer } from '@/lib/copilot/answerStructure'
import { useRepoInterview } from '@/lib/repo/useRepoInterview'
import { RepoInterviewPanel } from './RepoInterviewPanel'
import { useScreenRepository, type RepoTask } from '@/lib/repo/useScreenRepository'
import { ScreenRepositoryControls, RepoAnalysisView } from './ScreenRepositoryPanel'
import { useResponsePreferences } from '@/lib/copilot/useResponsePreferences'
import { ResponsePreferencesControls, WorkspaceEmptyState, WorkspaceModeNavigation } from './CopilotWorkspaceUi'

// Ask-your-transcript side panel. Grounded, streaming answers from the live
// transcript. Matches the app's editorial-glass language: glass surface, emerald
// signal, serif labels, pill quick-actions. Phase 1 = on-demand, transcript-only.
//
// getTranscript is a live getter (reads the current segments as plain text) so
// each question grounds in everything said so far — zero fetch, it's client state.
const QUICK_ACTIONS = [
  'Summarize the last few minutes',
  'What are the action items?',
  'What did I miss?',
]

// Screen frames are sent in modes that reason about visible code or diagrams.
// Repository mode has its own high-resolution extraction and watch controls.
// General/behavioral never attach a frame even if screen-sharing is left on, so
// no image is billed or leaked for a mode that can't use it.
const SCREEN_MODES: readonly CopilotMode[] = ['repoInterview', 'coding', 'systemDesign']
function usesScreen(mode: CopilotMode): boolean {
  return SCREEN_MODES.includes(mode)
}

export function CopilotPanel({
  getTranscript,
  onClose,
  width = 440,
  onResizeStart,
  variant = 'drawer',
  initialMode = 'general',
}: {
  getTranscript: () => string
  onClose?: () => void
  // Width + drag handler come from the PAGE (usePanelWidth) so the transcript can
  // reserve the same space — the panel sits BESIDE the transcript, not over it.
  width?: number
  onResizeStart?: (e: React.PointerEvent) => void
  variant?: 'drawer' | 'workspace'
  initialMode?: CopilotMode
}) {
  const workspace = variant === 'workspace'
  const responsePreferences = useResponsePreferences()
  const { turns, streaming, error, ask, clear, stop } = useCopilot(getTranscript, responsePreferences.preferences)
  const screen = useScreenStream()
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<CopilotMode>(initialMode)
  const repo = useRepoInterview(getTranscript, mode === 'repoInterview')
  const screenRepo = useScreenRepository(mode === 'repoInterview', screen.sharing, screen.grabCodeFrame, responsePreferences.preferences)
  const contexts = useModeContexts()
  const context = contexts[mode] // per-mode uploaded documents + answer instructions
  const profile = useCandidateProfile() // resume + JD: global, always-injected grounding
  const router = useOrchestrationRouter() // auto mode-routing + live web search for a question
  const feed = useAnswerFeed(responsePreferences.preferences)
  const me = useMeContext() // opt-in mic stream: "what I said" as AI context, never in transcript
  const [showContextEditor, setShowContextEditor] = useState(false)
  const orchestrator = useOrchestrator(ask)
  const feedBusy = feed.entries.some((entry) => entry.streaming)
  const pipelineBusy = orchestrator.stage !== 'idle' && orchestrator.stage !== 'done'
  const [auto, setAuto] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [showAnswerPreferences, setShowAnswerPreferences] = useState(false)
  const [mobileSetupOpen, setMobileSetupOpen] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preparingCaptured, setPreparingCaptured] = useState(false)
  const [preparationError, setPreparationError] = useState<string | null>(null)
  const [questionNotice, setQuestionNotice] = useState<string | null>(null)
  const [moreOpen, setMoreOpen] = useState(false) // overflow sheet for secondary controls
  const [view, setView] = useState<'chat' | 'answers'>('chat')
  const [repoRequestError, setRepoRequestError] = useState<string | null>(null)
  // Post-interview review: generated on demand from the session's Q&A + transcript.
  const [review, setReview] = useState<{ loading: boolean; text: string | null; error: string | null }>({ loading: false, text: null, error: null })
  const lockMode = useLockMode() // desktop: click-through overlay (unlock via hotkey/tray)
  const identity = useAppIdentity() // desktop: shares the name in Settings
  // The turn index the orchestrator's auto test result belongs to. Pinned when
  // the result is produced so a later coding-mode chat answer (a new last turn)
  // doesn't inherit the stale panel. Derived during render (React's store-prev
  // pattern) rather than in an effect, so it updates in the same commit as the
  // result appears — no flash of the panel on the wrong turn.
  const [autoTestTurn, setAutoTestTurn] = useState<number | null>(null)
  const [prevTestResult, setPrevTestResult] = useState(orchestrator.testResult)
  if (prevTestResult !== orchestrator.testResult) {
    setPrevTestResult(orchestrator.testResult)
    setAutoTestTurn(orchestrator.testResult ? turns.length - 1 : null)
  }
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const questionRefs = useRef(new Map<number, HTMLDivElement>())
  const submissionRef = useRef(false)
  const capturedRequestRef = useRef<symbol | null>(null)
  const preparationGeneration = useRef(0)
  const composerId = useId()
  const contextId = useId()
  const responseId = useId()
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null)
  const followsAnswer = useRef(true)
  const repoAnswerBusy = useRef(false)
  const typedRepoQuestion = input.trim()
  const repoTaskTarget = typedRepoQuestion
    ? { question: typedRepoQuestion, questionId: undefined }
    : screenRepo.displayId && screenRepo.displayAnalysis?.question
      ? { question: screenRepo.displayAnalysis.question, questionId: screenRepo.displayAnalysis.questionId }
      : repo.selected
        ? { question: repo.selected.text, questionId: repo.selected.id }
        : screenRepo.displayAnalysis?.question
          ? { question: screenRepo.displayAnalysis.question, questionId: screenRepo.displayAnalysis.questionId }
          : { question: '', questionId: undefined }
  const repoTaskQuestion = repoTaskTarget.question

  const answerRepoQuestion = useCallback(async (question: string, id?: string, task: RepoTask = 'plan', automatic = false) => {
    if (repoAnswerBusy.current) return
    const generation = preparationGeneration.current
    repoAnswerBusy.current = true
    setRepoRequestError(null)
    if (!automatic) screenRepo.setDisplayId(null)
    if (id) repo.mark(id, 'answering', question)
    try {
      const uploaded = context.count > 0 ? await context.retrieve(question) : null
      if (generation !== preparationGeneration.current) return false
      const evidence = [
        context.instructions && `User answer preferences: ${context.instructions}`,
        uploaded && `Uploaded context: ${uploaded}`,
        screenRepo.contextFor(question),
        repo.contextFor(question),
        `QUESTION LEDGER (include related asks and requirement changes):\n${repo.questions.slice(-12).map((item) => item.text).join('\n')}`,
        me.getMeContext() && `Candidate discussion: ${me.getMeContext()}`,
      ].filter(Boolean).join('\n\n')
      const ok = await screenRepo.analyze(question, evidence, getTranscript(), task, id)
      if (id) repo.mark(id, ok ? 'answered' : 'failed', question)
      return ok
    } catch (error) {
      if (id) repo.mark(id, 'failed', question)
      setRepoRequestError(error instanceof Error ? error.message : 'Could not prepare repository context. Retry this question.')
      return false
    } finally {
      repoAnswerBusy.current = false
    }
  }, [repo, screenRepo, me, getTranscript, context])

  // Capture is independent of generation. Drain every settled question in order;
  // failures stay in the ledger for an explicit retry instead of looping costs.
  useEffect(() => {
    if (!auto || mode !== 'repoInterview') return
    const timer = setInterval(() => {
      if (repoAnswerBusy.current) return
      const next = repo.questions.find((item) => item.status === 'captured' && Date.now() - (item.updatedAt ?? item.capturedAt) > 1200)
      if (next) void answerRepoQuestion(next.text, next.id, 'plan', true)
    }, 650)
    return () => clearInterval(timer)
  }, [auto, mode, repo.questions, answerRepoQuestion])

  // Pre-load execution runtime when coding mode is selected so test execution is instant.
  useEffect(() => {
    if (mode === 'coding') preloadRuntime('python')
  }, [mode])

  // Generate an answer for a heard question into the answer feed — shared by the
  // proactive auto-path AND the manual "Answer" button. Classifies → routes mode →
  // grounds (web/profile/story/chunk) → answers. `viaButton` skips the is-question
  // gate (the user explicitly asked, so answer even if the classifier is unsure).
  const answerQuestion = useCallback(
    (q: string, viaButton = false) => {
      if (capturedRequestRef.current || submissionRef.current || streaming || feedBusy || pipelineBusy) return Promise.resolve()
      const request = Symbol('captured question')
      capturedRequestRef.current = request
      const generation = preparationGeneration.current
      const current = () => capturedRequestRef.current === request && generation === preparationGeneration.current
      setPreparingCaptured(true)
      setPreparationError(null)
      setView('answers')
      return (async () => {
        try {
        if (mode === 'repoInterview') { await answerRepoQuestion(q); return }
        const routed = await router.route(q)
        if (!current()) return
        if (!viaButton && routed.classification && !routed.classification.isQuestion) return
        const answerMode: CopilotMode = routed.classification?.mode ?? mode
        if (answerMode !== mode) setMode(answerMode)
        if (answerMode === 'repoInterview') { await answerRepoQuestion(q); return }
        const routedContext = contexts[answerMode]
        const retrieved =
          answerMode === 'behavioral' && routedContext.storyCount > 0
            ? await routedContext.retrieveStories(q, 2).then((ss) =>
                ss.length ? ss.map((s) => `STORY — ${s.title}\n${s.fullText}`).join('\n\n---\n\n') : null,
              )
            : routedContext.count > 0
              ? await routedContext.retrieve(q)
              : null
        if (!current()) return
        const parts = [
          routed.webContext && `LIVE WEB RESULTS (current facts — prefer these for anything time-sensitive):\n${routed.webContext}`,
          profile.contextBlock(),
          me.getMeContext() && `What I said: ${me.getMeContext()}`,
          retrieved,
        ].filter(Boolean)
        const ctx = parts.length ? parts.join('\n\n') : null
        const image = screen.sharing && usesScreen(answerMode) ? screen.grabFrame() : null
        setPreparingCaptured(false)
        await feed.answer(q, answerMode, ctx, image, routedContext.instructions || null, getTranscript())
        } catch (cause) {
          if (current()) setPreparationError(cause instanceof Error ? cause.message : 'Could not prepare this question. Try Answer last question again.')
        } finally {
          if (capturedRequestRef.current === request) {
            capturedRequestRef.current = null
            setPreparingCaptured(false)
          }
        }
      })()
    },
    [mode, contexts, profile, me, screen, router, feed, getTranscript, answerRepoQuestion, streaming, feedBusy, pipelineBusy],
  )

  // Manual "Answer" button: answer the latest question heard in the transcript RIGHT
  // NOW (user controls timing instead of waiting for the auto settle). Null if none.
  const answerLatest = useCallback(() => {
    const q = latestQuestion(getTranscript())
    if (q) {
      setQuestionNotice(null)
      void answerQuestion(q, true)
    } else {
      setQuestionNotice('No question has been captured yet. Type a question below, or start listening and try again.')
      composerRef.current?.focus()
    }
  }, [answerQuestion, getTranscript])

  // Proactive: while auto is on, a settled (complete) heard question is answered
  // automatically into the navigable answer feed. Returns the promise so the hook's
  // in-flight guard holds until streaming finishes (no stacked duplicates).
  useProactive(auto && mode !== 'repoInterview' && !preparing && !streaming && !pipelineBusy, getTranscript, (q) => {
    return (async () => {
      await answerQuestion(q)
    })()
  })

  // Coding mode + screen sharing: auto-capture the screen periodically. When the
  // screen changes (new problem detected), the orchestrator pipeline kicks in:
  // extract problem → solve with Claude → auto-run tests → retry on failure.
  // Paused while the user is composing a manual question so it doesn't consume
  // the shared grabFrame diff-gate out from under submit().
  // ponytail: residual — grabFrame in useScreenStream (not owned here) diffs
  // against the last grab by ANY caller, so a manual ask on a screen that hasn't
  // changed since the last auto grab can still get image=null. Full fix needs a
  // force/ignore-gate option on grabFrame.
  useAutoCapture(
    auto && mode === 'coding' && screen.sharing && orchestrator.stage === 'idle' && !input.trim() && !preparing && !preparingCaptured && !streaming && !feedBusy,
    screen.grabFrame,
    (frame) => {
      if (streaming || feedBusy || submissionRef.current || capturedRequestRef.current) return
      orchestrator.process(frame, context.instructions || null)
    },
  )

  // Tear the screen stream down when the panel closes.
  useEffect(() => () => {
    preparationGeneration.current += 1
    capturedRequestRef.current = null
    screen.stop()
    me.stopListening()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the newest tokens as the answer streams in.
  useEffect(() => {
    const el = scrollRef.current
    if (el && followsAnswer.current) el.scrollTop = el.scrollHeight
  }, [turns])

  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(240, Math.max(workspace ? 96 : 64, el.scrollHeight))}px`
  }, [input, workspace])

  // Only this tab's thread — switching modes shows its own Q&A, not a shared one.
  const visibleTurns = turns.map((t, i) => ({ t, i })).filter(({ t }) => t.mode === mode)

  const submit = async (q: string) => {
    if (!q.trim() || submissionRef.current || capturedRequestRef.current || streaming || feedBusy || pipelineBusy || screenRepo.analysis?.running) return
    submissionRef.current = true
    const generation = ++preparationGeneration.current
    setPreparing(true)
    setPreparationError(null)
    setQuestionNotice(null)
    try {
      if (mode === 'repoInterview') {
        const answered = await answerRepoQuestion(q)
        if (answered && generation === preparationGeneration.current) setInput((current) => current === q ? '' : current)
        return
      }
      setView('chat')
      followsAnswer.current = true
      const image = screen.sharing && usesScreen(mode) ? screen.grabFrame() : null
      const retrieved =
        mode === 'behavioral' && context.storyCount > 0
          ? await context.retrieveStories(q, 2).then((stories) => stories.length
            ? stories.map((story) => `STORY — ${story.title}\n${story.fullText}`).join('\n\n---\n\n')
            : null)
          : context.count > 0 ? await context.retrieve(q) : null
      if (generation !== preparationGeneration.current) return
      const merged = [profile.contextBlock(), retrieved, me.getMeContext()].filter(Boolean).join('\n\n') || null
      setLastSubmitted(q)
      setInput((current) => current === q ? '' : current)
      setPreparing(false)
      await ask(q, mode, image, merged, context.instructions || null)
    } catch (cause) {
      if (generation === preparationGeneration.current) {
        setPreparationError(cause instanceof Error ? cause.message : 'Could not prepare this question. Your draft is still below; try again.')
      }
    } finally {
      if (generation === preparationGeneration.current) {
        setPreparing(false)
        submissionRef.current = false
      }
    }
  }

  const stopAnswer = () => {
    preparationGeneration.current += 1
    submissionRef.current = false
    capturedRequestRef.current = null
    setPreparing(false)
    setPreparingCaptured(false)
    setAuto(false)
    if (screenRepo.analysis?.running) screenRepo.stopAnalysis()
    feed.stop()
    orchestrator.reset()
    stop()
  }

  const choosePrompt = (prompt: string) => {
    setInput(prompt)
    setView('chat')
    composerRef.current?.focus()
  }

  const changeMode = (next: CopilotMode) => {
    if (preparing || preparingCaptured) {
      preparationGeneration.current += 1
      submissionRef.current = false
      capturedRequestRef.current = null
      setPreparing(false)
      setPreparingCaptured(false)
    }
    setMode(next)
    setPreparationError(null)
    setQuestionNotice(null)
  }

  // Post-interview review: summarize the session's questions (with auto-routed mode)
  // + transcript into coverage / LP / gaps. On demand — reuses the whole session.
  const runReview = async () => {
    if (review.loading) return
    setReview({ loading: true, text: null, error: null })
    try {
      const res = await fetch('/api/copilot/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: getTranscript(), questions: feed.questions() }),
      })
      const data = await res.json()
      if (!res.ok || !data.review) throw new Error(data.error || 'Review failed')
      setReview({ loading: false, text: data.review, error: null })
    } catch (e) {
      setReview({ loading: false, text: null, error: e instanceof Error ? e.message : 'Review failed' })
    }
  }

  const busy = preparing || preparingCaptured || streaming || !!screenRepo.analysis?.running || feed.entries.some((entry) => entry.streaming) || (orchestrator.stage !== 'idle' && orchestrator.stage !== 'done')
  const contextSummary = [
    profile.hasProfile && 'Background added',
    context.docs.length > 0 && `${context.docs.length} document${context.docs.length === 1 ? '' : 's'}`,
    context.instructions && 'Instructions set',
  ].filter(Boolean).join(' · ') || 'Resume, job description and notes'
  const questions = visibleTurns.filter(({ t }) => t.role === 'user')

  return (
    <aside
      aria-label={workspace ? 'AI Copilot workspace' : 'Assistant panel'}
      className={`${workspace ? 'reader-surface copilot-workspace relative flex w-full min-w-0 flex-col rounded-3xl' : 'glass copilot-panel relative flex h-full w-full flex-col overflow-hidden border-l border-black/10 sm:w-[var(--panel-w)] sm:rounded-l-3xl'}${focusMode ? ' lt-stealth' : ''}`}
      style={workspace ? undefined : { '--panel-w': `${width}px` } as CSSProperties}
    >
      {!workspace && onResizeStart && <div onPointerDown={onResizeStart} role="separator" aria-orientation="vertical" aria-label="Resize assistant panel" title="Drag to resize"
        className="absolute inset-y-0 left-0 z-10 hidden w-1.5 touch-none bg-black/10 hover:bg-emerald-700/30 sm:block" />}
      <header className="relative flex flex-wrap items-center gap-2 border-b border-black/10 px-4 py-3">
        <Sparkles size={16} aria-hidden className="shrink-0 text-[color:var(--signal)]" />
        <span className="font-[family-name:var(--font-serif)] text-base font-semibold">{workspace ? 'Questions & answers' : 'Ask'}</span>
        <div className="ml-auto flex items-center gap-1">
          <div data-active={auto} title="Answer captured questions automatically. Listening and screen sharing are controlled separately."
            className="flex min-h-11 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-black/70 data-[active=true]:text-emerald-800">
            Auto <LeverSwitch checked={auto} onChange={setAuto} label="Auto-answer questions" />
          </div>
          <div title="Focus changes contrast and motion. It does not hide the app from screen sharing or monitoring."
            className="flex min-h-11 items-center gap-1.5 rounded-full px-2 text-xs text-black/70">
            {focusMode ? <EyeOff size={15} aria-hidden /> : <Eye size={15} aria-hidden />}
            <span className={workspace ? 'hidden sm:inline' : 'sr-only'}>Focus</span>
            <LeverSwitch checked={focusMode} onChange={setFocusMode} label="Focus reading mode" />
          </div>
          <button type="button" onClick={() => setMoreOpen((value) => !value)} data-active={moreOpen} aria-label="More controls" aria-expanded={moreOpen}
            className="relative flex h-11 w-11 items-center justify-center rounded-full text-black/70 hover:bg-black/[0.06] data-[active=true]:bg-black/10">
            <MoreHorizontal size={18} aria-hidden />
            {(me.listening || screen.sharing) && !moreOpen && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-emerald-700" aria-hidden />}
          </button>
          {!workspace && onClose && <button type="button" onClick={onClose} aria-label="Close assistant" className="flex h-11 w-11 items-center justify-center rounded-full text-black/50 hover:bg-black/5"><X size={16} aria-hidden /></button>}
        </div>
        {moreOpen && <>
          <button type="button" className="fixed inset-0 z-20 cursor-default" aria-hidden tabIndex={-1} onClick={() => setMoreOpen(false)} />
          <div className="absolute right-3 top-full z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-2xl border border-black/10 bg-white p-1 shadow-xl" onKeyDown={(event) => { if (event.key === 'Escape') setMoreOpen(false) }}>
            <SheetItem active={me.listening} toggle icon={me.listening ? <Mic size={15} /> : <MicOff size={15} />}
              label={me.listening ? 'Stop your voice context' : 'Add your voice as context'} onClick={() => me.listening ? me.stopListening() : me.startListening()} />
            <SheetItem active={screen.sharing} toggle icon={screen.sharing ? <Monitor size={15} /> : <MonitorOff size={15} />}
              label={screen.sharing ? 'Stop sharing screen with AI' : 'Share screen with AI'} onClick={() => screen.sharing ? screen.stop() : screen.start()} />
            {lockMode.available && !lockMode.locked && <SheetItem active={false} icon={<Lock size={15} />} label="Lock (click-through)" onClick={() => { lockMode.enable(); setMoreOpen(false) }} />}
            {turns.length > 0 && <SheetItem active={false} icon={<X size={15} />} label="Clear all chat modes" onClick={() => { clear(); setMoreOpen(false) }} />}
            {identity.available && <div className="mt-1 border-t border-black/10 px-3 py-2">
              <label htmlFor={`${composerId}-app-name`} className="text-xs font-medium text-black/60">App name</label>
              <select id={`${composerId}-app-name`} value={identity.current} onChange={(event) => identity.setIdentity(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-black/15 bg-white px-2 py-2 text-xs text-ink">
                {identity.presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
              </select>
              <p className="mt-1 text-[11px] leading-relaxed text-black/50">Updates the header and window title. Custom name and icon are in Settings.</p>
            </div>}
            <p className="border-t border-black/10 px-3 py-2 text-[11px] leading-relaxed text-black/55">Focus and appearance settings change how the app looks. They do not guarantee invisibility to recording or monitoring.</p>
          </div>
        </>}
      </header>
      {focusMode && <p className="border-b border-black/10 px-4 py-2 text-xs text-black/55">Focus mode reduces motion and changes contrast. It does not hide this window.</p>}
      {workspace && <button type="button" onClick={() => setMobileSetupOpen((value) => !value)} aria-expanded={mobileSetupOpen} aria-controls={`${responseId}-setup`}
        className="flex min-h-12 items-center gap-2 border-b border-black/10 px-4 text-left text-sm text-black/70 hover:bg-black/5 lg:hidden">
        <SlidersHorizontal size={16} aria-hidden /><span>{MODE_PROFILES[mode].label} · {responsePreferences.preferences.format}</span><ChevronDown size={15} aria-hidden className={`ml-auto ${mobileSetupOpen ? 'rotate-180' : ''}`} />
      </button>}

      <div className={workspace ? 'copilot-workspace-grid grid min-w-0 lg:grid-cols-[17rem_minmax(0,1fr)]' : 'contents'}>
        <div id={`${responseId}-setup`} className={workspace ? `copilot-workspace-rail ${mobileSetupOpen ? 'block' : 'hidden'} border-b border-black/10 lg:block lg:border-b-0 lg:border-r` : 'contents'}>
          {workspace ? <WorkspaceModeNavigation mode={mode} onChange={changeMode} /> : <div aria-label="Interview focus" className="flex gap-1 overflow-x-auto border-b border-black/10 px-3 py-2">
            {MODE_ORDER.map((item) => <button key={item} type="button" onClick={() => changeMode(item)} aria-pressed={mode === item} data-active={mode === item} title={MODE_PROFILES[item].hint}
              className="min-h-11 shrink-0 rounded-full px-3 text-xs text-black/55 hover:bg-black/5 data-[active=true]:bg-ink data-[active=true]:text-white">{MODE_PROFILES[item].label}</button>)}
          </div>}
          {workspace ? <div className="border-t border-black/10"><ResponsePreferencesControls {...responsePreferences} /></div> : <div className="border-b border-black/10 px-4 py-1">
            <button type="button" onClick={() => setShowAnswerPreferences((value) => !value)} aria-expanded={showAnswerPreferences} aria-controls={responseId} className="flex min-h-11 w-full items-center gap-2 text-xs text-black/60 hover:text-ink">
              <SlidersHorizontal size={14} aria-hidden />Answer style <span className="ml-auto capitalize">{responsePreferences.preferences.format}</span><ChevronDown size={13} aria-hidden />
            </button>
            {showAnswerPreferences && <div id={responseId}><ResponsePreferencesControls {...responsePreferences} compact /></div>}
          </div>}
          <div className={workspace ? 'border-t border-black/10 px-4 py-4' : 'panel-section px-4 py-2'}>
            <button type="button" onClick={() => setShowContextEditor((value) => !value)} aria-expanded={showContextEditor} aria-controls={contextId}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl text-left text-sm font-medium text-ink hover:text-[color:var(--signal)]">
              <FileText size={16} aria-hidden />{showContextEditor ? 'Close context' : 'Your context'}<ChevronDown size={14} aria-hidden className={`ml-auto ${showContextEditor ? 'rotate-180' : ''}`} />
            </button>
            <p className="text-xs leading-relaxed text-black/55">{contextSummary}</p>
            {context.storyCount > 0 && <div className="mt-2 flex items-center gap-2 text-xs text-black/55"><span>{context.storyCount} stories</span><button type="button" onClick={context.resetSpent} className="min-h-11 px-2 text-emerald-800 hover:underline">New round</button></div>}
          </div>
          {workspace && questions.length > 0 && <section aria-label="Recent questions" className="border-t border-black/10 px-4 py-4">
            <h2 className="text-xs font-semibold text-ink">Recent questions <span className="font-normal text-black/50">({questions.length})</span></h2>
            <ol className="mt-2 space-y-1">{questions.slice(-8).map(({ t, i }) => <li key={i}><button type="button" onClick={() => {
              setView('chat'); requestAnimationFrame(() => questionRefs.current.get(i)?.scrollIntoView({ block: 'center' }))
            }} className="min-h-11 w-full rounded-lg px-2 py-2 text-left text-xs leading-relaxed text-black/60 hover:bg-black/5">{t.content.length > 110 ? `${t.content.slice(0, 110)}…` : t.content}</button></li>)}</ol>
            {questions.length > 8 && <p className="mt-2 text-[11px] text-black/50">Latest 8 shown. Earlier questions remain in the conversation.</p>}
          </section>}
        </div>

        <div className={workspace ? 'copilot-workspace-main flex min-w-0 flex-col' : 'contents'}>
          {mode !== 'repoInterview' && <div className="flex flex-wrap items-center gap-1 border-b border-black/10 px-4 py-2 text-xs">
            <button type="button" onClick={() => setView('chat')} aria-pressed={view === 'chat'} data-active={view === 'chat'} className="min-h-11 rounded-full px-3 text-black/60 hover:bg-black/5 data-[active=true]:bg-ink data-[active=true]:text-white">{workspace ? 'Conversation' : 'Chat'}</button>
            <button type="button" onClick={() => setView('answers')} aria-pressed={view === 'answers'} data-active={view === 'answers'} className="min-h-11 rounded-full px-3 text-black/60 hover:bg-black/5 data-[active=true]:bg-ink data-[active=true]:text-white">{workspace ? 'Captured questions' : 'Answers'}{feed.count > 0 ? ` (${feed.count})` : ''}</button>
            {workspace && usesScreen(mode) && <button type="button" onClick={() => screen.sharing ? screen.stop() : screen.start()} className="ml-auto flex min-h-11 items-center gap-1.5 rounded-full px-3 text-emerald-800 hover:bg-emerald-700/10"><Monitor size={14} aria-hidden />{screen.sharing ? 'Stop sharing' : 'Share screen'}</button>}
          </div>}
          {showContextEditor && <section id={contextId} aria-label="Your context" className={`border-b border-black/10 px-4 py-4 ${workspace ? 'sm:px-6' : 'max-h-[45%] shrink-0 overflow-y-auto'}`}>
            <div className="mx-auto max-w-3xl">
              <div className="mb-3 flex items-center gap-2"><h2 className="font-[family-name:var(--font-serif)] text-lg">Your context</h2><button type="button" onClick={() => setShowContextEditor(false)} aria-label="Close context editor" className="ml-auto flex h-11 w-11 items-center justify-center rounded-full text-black/50 hover:bg-black/5"><X size={16} aria-hidden /></button></div>
              <p className="mb-4 text-xs leading-relaxed text-black/55">Background and documents are saved on this device. Relevant context is sent to the AI when you ask a question.</p>
              <ContextEditor key={mode} context={context} profile={profile} />
              {(context.docs.length > 0 || context.instructions) && <button type="button" onClick={context.clear} className="mt-4 min-h-11 text-xs text-black/55 hover:text-[color:var(--stop)]">Clear {MODE_PROFILES[mode].label.toLowerCase()} documents and instructions</button>}
            </div>
          </section>}
          {mode === 'repoInterview' && <div className={workspace ? 'shrink-0' : 'max-h-[50%] shrink-0 overflow-y-auto'}>
            <ScreenRepositoryControls repo={screenRepo} sharing={screen.sharing} startSharing={screen.start} question={repoTaskQuestion}
              onAnalyze={(task) => void answerRepoQuestion(repoTaskQuestion, repoTaskTarget.questionId, task)} />
            <RepoInterviewPanel repo={repo} answering={!!screenRepo.analysis?.running} onSelect={screenRepo.showQuestion} onAnswer={(question, id) => void answerRepoQuestion(question, id)} />
            {repoRequestError && <p role="alert" className="border-b border-black/10 px-4 py-2 text-xs text-[color:var(--stop)]">{repoRequestError}</p>}
          </div>}
          {screen.sharing && <div role="status" className="flex flex-wrap items-center gap-2 border-b border-emerald-700/15 bg-emerald-700/5 px-4 py-2 text-xs text-emerald-800">
            <Monitor size={14} aria-hidden /><span className="flex-1">{mode === 'repoInterview' ? (screenRepo.watching ? 'IDE capture active. Changed views sent every 8 seconds.' : 'IDE shared. Use Capture code to read a view.') : auto && mode === 'coding' ? 'Screen shared. Changed coding problems are analyzed automatically.' : 'Screen shared with AI. Captured when you ask in Coding or System design.'}</span>
            <button type="button" onClick={screen.stop} className="min-h-11 rounded-full px-2 font-medium hover:bg-emerald-700/10">Stop sharing</button>
          </div>}
          {screen.error && <p role="alert" className="px-4 py-2 text-xs text-[color:var(--stop)]">{screen.error}</p>}
          {mode === 'coding' && orchestrator.stage !== 'idle' && orchestrator.stage !== 'done' && <OrchestratorStatus stage={orchestrator.stage} />}
          {mode === 'coding' && orchestrator.problem && <ExtractedProblemBar problem={orchestrator.problem} onDismiss={orchestrator.reset} />}
          {mode === 'coding' && orchestrator.error && <p role="alert" className="px-4 py-2 text-xs text-[color:var(--stop)]">{orchestrator.error}</p>}

          {mode === 'repoInterview' ? <RepoAnalysisView repo={screenRepo} onRetry={(question, task, questionId) => void answerRepoQuestion(question, questionId, task)} /> : view === 'answers' ?
            <AnswersView feed={feed} auto={auto} review={review} onReview={runReview} onAnswerLatest={answerLatest} /> :
            <div ref={scrollRef} onScroll={(event) => { const el = event.currentTarget; followsAnswer.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}
              className={workspace ? 'copilot-workspace-conversation min-h-80 flex-1 px-4 py-4 sm:px-7' : 'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4'}>
              <div className={workspace ? 'mx-auto max-w-3xl space-y-6' : 'space-y-4'}>
                {visibleTurns.length === 0 && !error && (workspace ? <WorkspaceEmptyState mode={mode} onChoose={choosePrompt} onAddContext={() => setShowContextEditor(true)} /> : <div className="pt-6 text-center">
                  <p className="font-[family-name:var(--font-serif)] text-lg text-black/50">Ask a question, or use the live transcript.</p>
                  <div className="mt-4 flex flex-col gap-2">{QUICK_ACTIONS.map((action) => <button key={action} type="button" onClick={() => choosePrompt(action)} className="glass glass-interactive min-h-11 rounded-full px-3 py-2 text-sm text-black/70 hover:text-ink">{action}</button>)}</div>
                </div>)}
                {visibleTurns.map(({ t, i }) => t.role === 'user' ? <div key={i} ref={(node) => { if (node) questionRefs.current.set(i, node); else questionRefs.current.delete(i) }} className={workspace ? 'border-b border-black/10 pb-4 pt-3' : 'flex justify-end'}>
                  {workspace && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--signal)]">Your question</p>}
                  <div className={workspace ? 'whitespace-pre-wrap break-words text-base font-medium leading-relaxed text-ink' : 'max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-sm text-white'}>{t.content}</div>
                </div> : <AssistantTurn key={i} content={t.content} streaming={streaming && i === turns.length - 1} autoRun={mode === 'coding' && i === turns.length - 1}
                  autoTestResult={mode === 'coding' && i === autoTestTurn && orchestrator.testResult ? orchestrator.testResult : undefined} />)}
                {error && <div role="alert" className="rounded-xl border border-[color:var(--stop)]/20 px-4 py-3 text-sm text-[color:var(--stop)]"><p>{error}</p>{lastSubmitted && <button type="button" disabled={busy} onClick={() => choosePrompt(lastSubmitted)} className="mt-2 min-h-11 underline underline-offset-4 disabled:opacity-50">Restore question to retry</button>}</div>}
              </div>
            </div>}

          <form noValidate onSubmit={(event) => { event.preventDefault(); void submit(input) }} className={`border-t border-black/10 ${workspace ? 'px-4 py-4 sm:px-7' : 'p-3'}`}>
            <div className={workspace ? 'mx-auto max-w-3xl' : ''}>
              {questionNotice && <p role="status" className="mb-2 text-xs leading-relaxed text-black/60">{questionNotice}</p>}
              {preparationError && <p id={`${composerId}-error`} role="alert" className="mb-2 text-xs text-[color:var(--stop)]">{preparationError}</p>}
              <label htmlFor={composerId} className="mb-2 block text-xs font-semibold text-ink">{mode === 'repoInterview' ? 'Repository question' : 'Your question'}</label>
              <div className="rounded-2xl border border-black/15 bg-white/70 p-2 focus-within:border-emerald-700/50">
                <textarea ref={composerRef} id={composerId} value={input} onChange={(event) => setInput(event.target.value)} rows={workspace ? 4 : 2}
                  aria-describedby={`${composerId}-help${preparationError ? ` ${composerId}-error` : ''}`} aria-invalid={!!preparationError}
                  onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void submit(input) } }}
                  placeholder={workspace && mode === 'general' ? 'Type a question, paste code, or describe what you want to understand…' : `${MODE_PROFILES[mode].hint}…`}
                  className="block min-h-16 w-full resize-none border-0 bg-transparent px-2 py-1.5 text-sm leading-relaxed text-ink outline-none" />
                <div className="flex flex-wrap items-center gap-2 px-1 pt-1">
                  <p id={`${composerId}-help`} className="min-w-0 flex-1 text-[11px] leading-relaxed text-black/50">{preparing || preparingCaptured ? 'Preparing context…' : streaming ? 'Generating answer…' : 'Enter for a new line · Ctrl / ⌘ + Enter to send'}</p>
                  {busy ? <button type="button" onClick={stopAnswer} className="btn-ghost flex min-h-11 items-center gap-2 px-3 text-xs"><Square size={13} aria-hidden />Stop generating</button> : <button type="submit" disabled={!input.trim()} aria-label="Send question" className="btn-signal flex min-h-11 min-w-11 items-center justify-center gap-2 px-4 text-sm disabled:opacity-40"><Send size={15} aria-hidden /><span className={workspace ? '' : 'sr-only'}>Ask AI</span></button>}
                </div>
              </div>
              {workspace && <p className="mt-2 text-[11px] leading-relaxed text-black/50">Answers use your question and any context you provide. Check suggestions against the original code and your own experience.</p>}
            </div>
          </form>
        </div>
      </div>
    </aside>
  )
}

// Upload documents (files or pasted text) + set answer instructions for the
// active mode's chat. Files are read client-side, chunked + embedded on add;
// nothing persists server-side — vectors live in this device's localStorage.
function ContextEditor({
  context,
  profile,
}: {
  context: ReturnType<typeof useModeContext>
  profile: ReturnType<typeof useCandidateProfile>
}) {
  const [pasteText, setPasteText] = useState('')
  const [instructionsDraft, setInstructionsDraft] = useState(context.instructions)
  const [savedInstructions, setSavedInstructions] = useState(context.instructions)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Documents list collapses so a long list of uploads doesn't push the composer
  // off-screen. Default open only when there's nothing yet (nudge to add).
  const [docsOpen, setDocsOpen] = useState(true)
  const fieldId = useId()

  // Keep external changes (mode switches / Clear) in sync without an Effect that
  // synchronously sets state. A user's unsaved draft remains intact because the
  // persisted value is unchanged while they type.
  if (savedInstructions !== context.instructions) {
    setSavedInstructions(context.instructions)
    setInstructionsDraft(context.instructions)
  }

  // The saved instructions are dirty when the draft diverges from what's persisted.
  const instructionsDirty = instructionsDraft !== context.instructions
  const saveInstructions = () => context.setInstructions(instructionsDraft)

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      await context.addDocument(file.name, await file.text())
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addPaste = async () => {
    if (!pasteText.trim()) return
    await context.addDocument(`Pasted ${new Date().toLocaleDateString()}`, pasteText)
    setPasteText('')
  }

  return (
    <div className="mt-2 space-y-3">
      {/* Resume + JD — GLOBAL, always-injected grounding (all modes). Set once. */}
      <div>
        <div className="flex items-center gap-2">
          <label htmlFor={`${fieldId}-resume`} className="text-[11px] font-medium uppercase tracking-wide text-black/40">
            Your background <span className="normal-case text-black/30">· grounds every mode</span>
          </label>
          {profile.hasProfile && (
            <button onClick={profile.clear} className="ml-auto rounded-full px-2 py-0.5 text-[11px] text-black/40 hover:bg-black/5">
              Clear
            </button>
          )}
        </div>
        <textarea
          id={`${fieldId}-resume`}
          aria-label="Resume and background"
          value={profile.resume}
          onChange={(e) => profile.setResume(e.target.value)}
          rows={3}
          placeholder="Paste your resume — the AI grounds behavioral stories, coding language, and design domain in your real background…"
          className="mt-1 w-full resize-none rounded-lg border border-black/15 bg-white/80 p-2 text-sm outline-none focus:border-emerald-700"
        />
        <label htmlFor={`${fieldId}-jd`} className="mt-3 block text-[11px] font-medium uppercase tracking-wide text-black/50">Job description</label>
        <textarea
          id={`${fieldId}-jd`}
          value={profile.jd}
          onChange={(e) => profile.setJd(e.target.value)}
          rows={2}
          placeholder="…and paste the job description (optional) to tune answers to the role."
          className="mt-1.5 w-full resize-none rounded-lg border border-black/15 bg-white/80 p-2 text-sm outline-none focus:border-emerald-700"
        />
        {profile.savedNote && <p className="mt-1 text-[11px] text-[color:var(--stop)]">{profile.savedNote}</p>}
      </div>

      <div>
        <label htmlFor={`${fieldId}-instructions`} className="text-[11px] font-medium uppercase tracking-wide text-black/40">Instructions</label>
        <textarea
          id={`${fieldId}-instructions`}
          value={instructionsDraft}
          onChange={(e) => setInstructionsDraft(e.target.value)}
          onBlur={saveInstructions}
          rows={3}
          placeholder="How should this chat answer? e.g. &quot;Cite the section number&quot;, &quot;Keep answers under 3 sentences&quot;…"
          className="mt-1 w-full resize-none rounded-lg border border-black/15 bg-white/80 p-2 text-sm outline-none focus:border-emerald-700"
        />
        {/* Explicit Save (autosave on blur still runs) so it's clear the
            instructions are stored, and mobile/keyboard users have a real control. */}
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={saveInstructions}
            disabled={!instructionsDirty}
            className="btn-signal px-3 py-1 text-xs disabled:opacity-40"
          >
            {instructionsDirty ? 'Save instructions' : 'Saved'}
          </button>
          {!instructionsDirty && instructionsDraft && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-800">
              <Check size={11} /> Saved
            </span>
          )}
        </div>
      </div>

      <div>
        <button
          onClick={() => setDocsOpen((v) => !v)}
          aria-expanded={docsOpen}
          className="flex w-full items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-black/40 hover:text-black/60"
        >
          <ChevronDown
            size={12}
            className={`shrink-0 transition-transform ${docsOpen ? '' : '-rotate-90'}`}
          />
          Documents{context.docs.length > 0 ? ` (${context.docs.length})` : ''}
        </button>
        {docsOpen && (
        <>
        {context.docs.length > 0 && (
          <ul className="mt-1 space-y-1">
            {context.docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded-lg bg-black/[0.03] px-2 py-1 text-xs">
                <span className="truncate">{d.name}</span>
                <span className="shrink-0 text-black/40">
                  {d.chunks.length} snippet{d.chunks.length === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => context.removeDocument(d.id)}
                  aria-label={`Remove ${d.name}`}
                  className="ml-auto shrink-0 text-black/40 hover:text-[color:var(--stop)]"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-1.5 flex items-center gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={context.saving}
            className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {context.saving ? 'Adding…' : 'Upload file'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Upload context documents"
            accept=".txt,.md,.html,.htm,text/plain,text/markdown,text/html"
            multiple
            onChange={(e) => onFiles(e.target.files)}
            className="hidden"
          />
          <span className="text-[11px] text-black/40">.txt / .md / .html story book · stored on this device</span>
        </div>
        <div className="mt-2">
          <label htmlFor={`${fieldId}-paste`} className="mb-1 block text-xs font-medium text-black/60">Paste a document</label>
          <textarea
            id={`${fieldId}-paste`}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder="…or paste text to add as a document"
            className="w-full resize-none rounded-lg border border-black/15 bg-white/80 p-2 text-sm outline-none focus:border-emerald-700"
          />
          <button
            onClick={addPaste}
            disabled={context.saving || !pasteText.trim()}
            className="btn-signal mt-1.5 px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {context.saving ? 'Adding…' : 'Add pasted text'}
          </button>
        </div>
        {context.error && <p className="mt-1 text-xs text-[color:var(--stop)]">{context.error}</p>}
        </>
        )}
      </div>
    </div>
  )
}

// Slow, hands-free auto-scroll of a finished answer so the user can read without
// touching anything. Kicks in once the answer STOPS streaming (scrolling a still-
// growing answer would fight the token flow); creeps ~24px/sec. Any manual scroll,
// wheel, or touch cancels it, and switching answers restarts it. Respects
// prefers-reduced-motion (skips the animation entirely).
function useSlowAutoScroll(
  ref: React.RefObject<HTMLDivElement | null>,
  entryId: number | undefined,
  streaming: boolean,
  enabled: boolean,
) {
  useEffect(() => {
    const el = ref.current
    if (!el || !enabled || streaming || entryId === undefined) return
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return

    let cancelled = false
    let last = 0
    const SPEED = 24 // px per second — unhurried reading pace
    let raf = 0
    // The step idles (doesn't advance) until content overflows, so it survives a
    // short answer whose tall content (an async-mounted Mermaid SVG, late markdown
    // reflow) only exceeds the viewport AFTER the effect runs — a ResizeObserver
    // no longer needed: we just never give up while the loop is alive.
    const step = (t: number) => {
      if (cancelled) return
      const canScroll = el.scrollHeight > el.clientHeight + 1
      if (last && canScroll) {
        el.scrollTop = el.scrollTop + (SPEED * (t - last)) / 1000
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return // reached the end
      }
      last = t
      raf = requestAnimationFrame(step)
    }
    // A user gesture cancels the auto-scroll so we never fight the reader.
    const cancel = () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
    el.addEventListener('wheel', cancel, { passive: true })
    el.addEventListener('touchstart', cancel, { passive: true })
    el.addEventListener('pointerdown', cancel, { passive: true })
    // Small delay so the finished answer is on screen a beat before it starts.
    const startTimer = setTimeout(() => { raf = requestAnimationFrame(step) }, 600)

    return () => {
      cancelled = true
      clearTimeout(startTimer)
      cancelAnimationFrame(raf)
      el.removeEventListener('wheel', cancel)
      el.removeEventListener('touchstart', cancel)
      el.removeEventListener('pointerdown', cancel)
    }
  }, [ref, entryId, streaming, enabled])
}

// One row in the header overflow sheet — a roomy labeled control, active state
// shown by the signal color so an "on" toggle is obvious in the list.
function SheetItem({
  active,
  icon,
  label,
  onClick,
  toggle = false,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
  /** On/off rows render a trailing lever switch instead of the active dot. */
  toggle?: boolean
}) {
  // High contrast in BOTH states so it's never faint: inactive = solid ink text on
  // the white sheet; active = a filled emerald pill (obvious "on" affordance, not a
  // subtle color shift). The sheet is always bg-white (set on its container), so
  // this reads the same regardless of stealth/translucent panel behind it.
  return (
    <button
      onClick={onClick}
      data-active={active}
      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs text-ink transition-colors hover:bg-black/[0.06] data-[active=true]:bg-emerald-700/12 data-[active=true]:font-medium data-[active=true]:text-emerald-900"
    >
      <span className={active ? 'text-emerald-700' : 'text-ink/55'}>{icon}</span>
      <span className="flex-1">{label}</span>
      {toggle ? (
        // Visual-only: the whole row is the button; a nested input would be
        // invalid inside a <button>, so render the switch decorative.
        <span className="scale-75" aria-hidden>
          <LeverSwitch checked={active} decorative />
        </span>
      ) : (
        active && <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
      )}
    </button>
  )
}

// The navigable auto-answer feed: one Q&A card at a time, paged prev/next.
function AnswersView({
  feed,
  auto,
  review,
  onReview,
  onAnswerLatest,
}: {
  feed: ReturnType<typeof useAnswerFeed>
  auto: boolean
  review: { loading: boolean; text: string | null; error: string | null }
  onReview: () => void
  onAnswerLatest: () => void
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const e = feed.current
  // Hands-free reading: gently scroll a finished answer top→bottom (see hook).
  useSlowAutoScroll(bodyRef, e?.id, e?.streaming ?? false, feed.count > 0)
  // Reset scroll to the top whenever the shown answer changes, so auto-scroll
  // starts from the beginning of the new answer.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [e?.id])

  if (feed.count === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-4 py-8 text-center">
        <p className="font-[family-name:var(--font-serif)] text-lg text-black/40">
          {auto ? 'Auto is ready. Questions from your transcript will appear here when you start listening.' : 'Captured questions appear here. Start listening, then answer a question manually or turn on Auto.'}
        </p>
        {/* Manual Answer: answer the latest heard question on demand, without waiting
            for the auto settle (or with Auto off entirely). */}
        <button onClick={onAnswerLatest} className="btn-signal flex items-center gap-1.5 px-4 py-2 text-sm">
          <Sparkles size={15} /> Answer last question
        </button>
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-black/[0.07] px-4 py-2.5 text-xs text-black/50">
        <button onClick={feed.prev} disabled={feed.cursor === 0} className="rounded-full p-1 hover:bg-black/5 disabled:opacity-30" aria-label="Previous">
          <ChevronLeft size={16} />
        </button>
        <span className="tabular-nums">{feed.cursor + 1} / {feed.count}</span>
        <button onClick={feed.next} disabled={feed.cursor >= feed.count - 1} className="rounded-full p-1 hover:bg-black/5 disabled:opacity-30" aria-label="Next">
          <ChevronRight size={16} />
        </button>
        {/* Answer the latest heard question on demand (in addition to auto). */}
        <button
          onClick={onAnswerLatest}
          className="flex items-center gap-1 rounded-full px-2 py-1 font-medium text-emerald-800 hover:bg-emerald-700/10"
          title="Answer the last question heard, now"
        >
          <Sparkles size={13} /> Answer
        </button>
        {e?.failed && (
          <button onClick={() => feed.retry(e.id)} className="rounded-full px-2 py-1 text-emerald-800 hover:bg-emerald-700/10" title="Retry this answer">
            Retry
          </button>
        )}
        {(() => {
          // Live p50/p95 time-to-first-token over this session — "fast" measured on
          // the spot, not asserted. Recomputes as each answer lands (feed re-renders).
          const s = latencyStats()
          return s ? (
            <span
              className="ml-auto mr-1 tabular-nums text-[11px] text-black/40"
              title={`Time-to-first-token this session, ${s.count} answer${s.count === 1 ? '' : 's'}`}
            >
              TTFT p50 {s.p50}ms · p95 {s.p95}ms
            </span>
          ) : null
        })()}
        {/* Post-interview review — recap coverage / LPs / gaps from the whole session. */}
        <button
          onClick={onReview}
          disabled={review.loading}
          className={`${latencyStats() ? '' : 'ml-auto '}rounded-full px-2 py-1 text-emerald-800 hover:bg-emerald-700/10 disabled:opacity-50`}
          title="Review this session — coverage, Leadership Principles, and what to tighten"
        >
          {review.loading ? 'Reviewing…' : 'Review'}
        </button>
        <button onClick={feed.clear} className="rounded-full px-2 py-1 text-black/45 hover:bg-black/5 hover:text-ink">Clear</button>
      </div>
      {(review.text || review.error) && (
        <div className="max-h-[45%] overflow-y-auto border-b border-emerald-700/15 bg-emerald-700/[0.04] px-4 py-3">
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-emerald-800">Session review</div>
          {review.error ? (
            <p className="text-xs text-[color:var(--stop)]">{review.error}</p>
          ) : (
            <RichContent content={review.text ?? ''} streaming={false} />
          )}
        </div>
      )}
      <div ref={bodyRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5 sm:px-6">
        <div className="text-xs font-medium uppercase tracking-wide text-[color:var(--signal)]">Question</div>
        <p className="text-base font-medium leading-snug text-ink">{e?.question}</p>
        {(() => {
          // Two-pass draft protocol: while a fast draft is showing, badge it as a
          // "Quick take"; it's cleanly replaced by the refined answer when ready.
          const parsed = parseDraftStream(e?.answer ?? '')
          return (
            <>
              <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-black/40">
                {parsed.phase === 'draft' ? (
                  <span className="flex items-center gap-1 text-amber-700">
                    <span className="live-dot" aria-hidden /> Quick take
                  </span>
                ) : (
                  'Answer'
                )}
              </div>
              {/* Structure-native: say-this-now hero + body + reserve drawer, so a
                  one-second glance lands on the line to say next. */}
              <StructuredAnswer content={parsed.text} streaming={e?.streaming ?? false} />
            </>
          )
        })()}
        {e?.retrying && (
          <p className="flex items-center gap-1.5 text-xs text-black/50">
            <span className="live-dot" aria-hidden /> Retrying…
          </p>
        )}
        {e?.failed && !e.streaming && (
          <p role="alert" className="text-xs text-[color:var(--stop)]">{e.error || 'Could not finish this answer. Tap Retry above.'}</p>
        )}
      </div>
    </div>
  )
}

function AssistantTurn({
  content,
  streaming,
  autoRun,
  autoTestResult,
}: {
  content: string
  streaming: boolean
  autoRun?: boolean
  autoTestResult?: TestRunResult
}) {
  const [result, setResult] = useState<RunResult | null>(null)
  const [testResult, setTestResult] = useState<TestRunResult | null>(null)
  const [running, setRunning] = useState(false)
  // Strip the two-pass draft framing so code extraction + render see clean text.
  const { text: displayContent, phase } = parseDraftStream(content)
  const codeBlock = streaming ? null : extractCode(displayContent)
  const testsBlock = streaming ? null : extractTests(displayContent)

  const displayTestResult = testResult ?? autoTestResult ?? null

  // "remote" must reflect the language that ACTUALLY executes — that's the tests
  // block (run() executes on testsBlock.language), falling back to the code block.
  // Deriving it from codeBlock alone let a tests-block language mismatch slip a
  // remote language past the no-egress-without-click guard.
  const execLang = testsBlock?.language ?? codeBlock?.language
  const remote = execLang ? isRemoteLanguage(execLang) : false

  const run = async () => {
    if (!codeBlock) return
    setRunning(true)
    setResult(null)
    setTestResult(null)
    if (testsBlock && canExecute(testsBlock.language)) {
      setTestResult(await executeTests(codeBlock.code, testsBlock.tests, testsBlock.language))
    } else if (!remote && canExecute(codeBlock.language)) {
      // Bare-snippet run (stdout) is a LOCAL-only convenience; remote languages need
      // the test-harness program, so without a :tests block there's nothing to run.
      setResult(await executeCode(codeBlock.code, codeBlock.language))
    }
    setRunning(false)
  }

  // Runnable if local, or remote WITH a tests block (the harness program to execute).
  const executable = codeBlock && canExecute(codeBlock.language) && (!remote || !!testsBlock)

  // Auto-run once a typed coding answer settles — LOCAL languages only (running
  // remote code would egress without a click). Runs a single time per answer; the
  // screen-capture orchestrator already self-verifies its own path.
  const autoRanRef = useRef(false)
  useEffect(() => {
    if (!autoRun || streaming || autoRanRef.current) return
    if (!codeBlock || !testsBlock || remote || !canExecute(testsBlock.language)) return
    // Schedule the event-like execution outside the Effect body. `run` updates
    // UI state immediately, which React correctly rejects when called directly
    // from an Effect under react-hooks/set-state-in-effect.
    const timer = window.setTimeout(() => {
      if (autoRanRef.current) return
      autoRanRef.current = true
      void run()
    }, 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun, streaming, codeBlock, testsBlock, remote])

  return (
    <div className="flex flex-col items-start gap-2">
      {phase === 'draft' && (
        <span className="flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-amber-700">
          <span className="live-dot" aria-hidden /> Quick take
        </span>
      )}
      <RichContent content={displayContent} streaming={streaming} />
      {codeBlock && executable && (
        <div className="w-full">
          {!autoTestResult && (
            <button
              onClick={run}
              disabled={running}
              className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-50"
              title={remote ? `Run ${codeBlock.language} tests on the remote sandbox (code leaves your device)` : `Run ${codeBlock.language} tests in the browser sandbox`}
            >
              <Play size={12} /> {running ? 'Running…' : testsBlock ? 'Run tests' : 'Run code'}
              {remote && <span className="ml-1 text-black/40">· remote</span>}
            </button>
          )}

          {displayTestResult && <TestResultsPanel result={displayTestResult} />}

          {result && (
            <div
              className={`mt-1.5 rounded-lg border px-3 py-2 font-mono text-xs ${
                result.ok
                  ? 'border-emerald-700/25 bg-emerald-700/5 text-emerald-900'
                  : 'border-[color:var(--stop)]/25 bg-[color:var(--stop)]/5 text-[color:var(--stop)]'
              }`}
            >
              <div className="mb-1 flex items-center gap-1.5 font-sans font-medium">
                {result.ok ? <Check size={12} /> : <X size={12} />}
                {result.ok ? 'Ran successfully' : 'Error'}
              </div>
              <pre className="whitespace-pre-wrap break-words">{result.error ?? result.output ?? '(no output)'}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Structure-native answer: the say-this-now LEDE as a pinned hero, the supporting
// script as the body, and DO-NOT-say-aloud material (glossary / follow-ups / metric
// defense) tucked into a "Reserve" drawer that opens only when the interviewer
// probes. This expresses the answer's structure so a one-second glance lands on the
// line to say next — the product's core reading experience.
function StructuredAnswer({ content, streaming }: { content: string; streaming: boolean }) {
  const { lede, body, reserve } = splitAnswer(content)
  return (
    <div className="space-y-3">
      {lede && (
        // Tier 1 — the hero line. Larger, near-full-contrast, accent left-rule.
        <p className="border-l-[3px] border-[color:var(--signal)] pl-4 text-xl font-medium leading-snug text-ink">
          {lede}
          {streaming && !body && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-[color:var(--signal)] align-middle" aria-hidden />}
        </p>
      )}
      {body && <RichContent content={body} streaming={streaming && !reserve} />}
      {reserve && (
        // Tier 3 — reserve. Recessed + collapsed; the safety net that must never be
        // read aloud by reflex. Opens on demand when a follow-up actually lands.
        <details className="rounded-lg border border-black/10 bg-black/[0.02]">
          <summary className="cursor-pointer px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-black/45">
            Reserve — don&rsquo;t say aloud (follow-ups, glossary, metrics)
          </summary>
          <div className="px-3 pb-2 opacity-80">
            <RichContent content={reserve} streaming={false} />
          </div>
        </details>
      )}
    </div>
  )
}

// Renders assistant content as markdown with inline Mermaid diagrams. Mermaid
// fences are pulled out and rendered as live diagrams; everything else (headings,
// lists, tables, bold, inline/fenced code) renders as formatted markdown so the
// answer reads like a designed document during hands-free auto-scroll.
function RichContent({ content, streaming }: { content: string; streaming: boolean }) {
  const parts = content.split(/(```mermaid\n[\s\S]*?```)/g)

  return (
    <div className="max-w-none break-words text-[15px] leading-7 text-ink sm:text-base">
      {parts.map((part, i) => {
        const mermaidMatch = part.match(/```mermaid\n([\s\S]*?)```/)
        if (mermaidMatch) {
          return <MermaidDiagram key={i} code={mermaidMatch[1].trim()} />
        }
        if (!part.trim()) return null
        return <Markdown key={i}>{part}</Markdown>
      })}
      {streaming && (
        <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[color:var(--signal)] align-middle" aria-hidden />
      )}
    </div>
  )
}

// Pinned exact version + SRI so a compromised/altered CDN file can't execute.
// integrity hash is sha384 of this exact file (verified against the CDN); bump
// both together if the version changes.
const MERMAID_VERSION = '11.9.0'
const MERMAID_CDN = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_VERSION}/dist/mermaid.min.js`
const MERMAID_SRI = 'sha384-UzWEhMP22MxNnr2bzqAdmtf1FDy5iKDUq6hLXJFLqC7dfGkc6W/hshbx9m71zyt5'
const MERMAID_INIT = { startOnLoad: false, theme: 'neutral', securityLevel: 'strict' } as const

let mermaidReady: Promise<void> | null = null

function loadMermaid(): Promise<void> {
  if (mermaidReady) return mermaidReady
  mermaidReady = new Promise<void>((resolve, reject) => {
    const existing = (window as unknown as Record<string, { initialize: (o: object) => void } | undefined>).mermaid
    if (existing) {
      existing.initialize(MERMAID_INIT) // strict mode before first render, even on the early path
      return resolve()
    }
    const s = document.createElement('script')
    s.src = MERMAID_CDN
    s.integrity = MERMAID_SRI
    s.crossOrigin = 'anonymous'
    s.onload = () => {
      const m = (window as unknown as Record<string, { initialize: (o: object) => void }>).mermaid
      m.initialize(MERMAID_INIT)
      resolve()
    }
    s.onerror = () => {
      mermaidReady = null
      reject(new Error('Failed to load diagram renderer'))
    }
    document.head.appendChild(s)
  })
  return mermaidReady
}

function MermaidDiagram({ code }: { code: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        await loadMermaid()
        if (cancelled || !containerRef.current) return
        const m = (window as unknown as Record<string, { render: (id: string, code: string) => Promise<{ svg: string }> }>).mermaid
        const { svg } = await m.render(`mermaid-${Date.now()}-${Math.random().toString(36).slice(2)}`, code)
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Diagram render failed')
      }
    })()
    return () => { cancelled = true }
  }, [code])

  if (error) {
    return <pre className="my-2 rounded-lg border border-black/10 bg-black/[0.03] p-3 text-xs text-black/50">{code}</pre>
  }

  return (
    <div ref={containerRef} className="my-2 overflow-x-auto rounded-lg border border-black/10 bg-white p-3" />
  )
}

const STAGE_LABELS: Record<OrchestratorStage, string> = {
  idle: '',
  extracting: 'Extracting problem from screen…',
  solving: 'Generating solution with Claude…',
  executing: 'Running tests…',
  retrying: 'Tests failed — fixing solution…',
  done: '',
}

function OrchestratorStatus({ stage }: { stage: OrchestratorStage }) {
  const label = STAGE_LABELS[stage]
  if (!label) return null
  return (
    <div className="flex items-center gap-2 border-b border-emerald-700/15 bg-emerald-700/5 px-4 py-2 text-xs text-emerald-800">
      <span className="live-dot" aria-hidden />
      {label}
    </div>
  )
}

function ExtractedProblemBar({
  problem,
  onDismiss,
}: {
  problem: ExtractedProblem
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border-b border-black/10 bg-black/[0.02] px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">Problem detected</span>
        {problem.language && (
          <span className="rounded bg-black/5 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-black/50">
            {problem.language}
          </span>
        )}
        <button
          onClick={() => setExpanded(v => !v)}
          className="text-emerald-800 hover:underline"
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
        <button
          onClick={onDismiss}
          className="ml-auto text-black/40 hover:text-[color:var(--stop)]"
        >
          <X size={12} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1.5 text-black/70">
          <p className="font-medium text-ink">{problem.question}</p>
          {problem.constraints.length > 0 && (
            <p><span className="text-black/40">Constraints:</span> {problem.constraints.join(', ')}</p>
          )}
          {problem.examples.length > 0 && (
            <div>
              <span className="text-black/40">Examples:</span>
              {problem.examples.map((e, i) => (
                <p key={i} className="ml-2 font-mono">{e.input} → {e.output}</p>
              ))}
            </div>
          )}
          {problem.edgeCases.length > 0 && (
            <p><span className="text-black/40">Edge cases:</span> {problem.edgeCases.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function TestResultsPanel({ result }: { result: TestRunResult }) {
  const allPassed = result.failed === 0
  return (
    <div className="mt-1.5 w-full rounded-lg border border-black/10 bg-black/[0.02] text-xs">
      {/* Summary bar */}
      <div
        className={`flex items-center gap-2 rounded-t-lg px-3 py-2 font-sans font-medium ${
          allPassed
            ? 'bg-emerald-700/10 text-emerald-800'
            : 'bg-[color:var(--stop)]/10 text-[color:var(--stop)]'
        }`}
      >
        {allPassed ? <Check size={14} /> : <X size={14} />}
        <span>
          {allPassed
            ? `All ${result.total} tests passed`
            : `${result.passed}/${result.total} passed`}
        </span>
      </div>

      {/* Per-case results */}
      <ul className="divide-y divide-black/5">
        {result.cases.map((c, i) => (
          <li key={i} className="flex items-start gap-2 px-3 py-1.5">
            <span className="mt-0.5 shrink-0">
              {c.passed ? (
                <Check size={12} className="text-emerald-700" />
              ) : (
                <X size={12} className="text-[color:var(--stop)]" />
              )}
            </span>
            <span className="flex-1 font-mono">
              <span className={c.passed ? 'text-emerald-800' : 'text-[color:var(--stop)]'}>
                {c.label}
              </span>
              {c.error && (
                <span className="mt-0.5 block text-[color:var(--stop)]/70">{c.error}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
