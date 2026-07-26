'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Check, Lock, Monitor, MonitorOff, Play, Send, Sparkles, X } from 'lucide-react'
import { useLockMode } from '@/lib/desktop/useLockMode'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { useScreenStream } from '@/lib/vision/useScreenStream'
import { useModeContext } from '@/lib/copilot/useModeContext'
import { useProactive } from '@/lib/copilot/useProactive'
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
  preloadRuntime,
  type TestRunResult,
} from '@/lib/copilot/codeExecutor'
import { type RunResult } from '@/lib/copilot/pyodideRunner'
import { useAutoCapture } from '@/lib/vision/useAutoCapture'
import { useOrchestrator, type OrchestratorStage, type ExtractedProblem } from '@/lib/copilot/useOrchestrator'

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

export function CopilotPanel({
  getTranscript,
  onClose,
  width,
  onResizeStart,
}: {
  getTranscript: () => string
  onClose: () => void
  // Width + drag handler come from the PAGE (usePanelWidth) so the transcript can
  // reserve the same space — the panel sits BESIDE the transcript, not over it.
  width: number
  onResizeStart: (e: React.PointerEvent) => void
}) {
  const { turns, streaming, error, ask, clear } = useCopilot(getTranscript)
  const screen = useScreenStream()
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<CopilotMode>('general')
  const context = useModeContext(mode) // per-mode uploaded documents + answer instructions
  const feed = useAnswerFeed()
  const me = useMeContext() // opt-in mic stream: "what I said" as AI context, never in transcript
  const [showContextEditor, setShowContextEditor] = useState(false)
  const orchestrator = useOrchestrator(ask)
  const [auto, setAuto] = useState(false)
  const [view, setView] = useState<'chat' | 'answers'>('chat')
  const lockMode = useLockMode() // desktop: click-through overlay (unlock via hotkey/tray)
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

  // Pre-load execution runtime when coding mode is selected so test execution is instant.
  useEffect(() => {
    if (mode === 'coding') preloadRuntime('python')
  }, [mode])

  // Proactive: while auto is on, questions heard in the transcript are answered
  // automatically into the SEPARATE navigable answer feed (not the chat thread).
  // Pulls this mode's uploaded-document context; a screen frame attaches if
  // sharing is on.
  useProactive(auto, getTranscript, (q) => {
    setView('answers') // surface the feed as answers arrive
    // Return the promise so useProactive's in-flight guard holds until this
    // answer finishes streaming (no duplicate answers as the ASR tail revises).
    return (async () => {
      const retrieved = context.count > 0 ? await context.retrieve(q) : null
      // Combine what YOU said (mic context, if listening) with any matched context
      // document chunk — grounds the answer without either appearing in the transcript.
      const parts = [me.getMeContext() && `What I said: ${me.getMeContext()}`, retrieved].filter(Boolean)
      const ctx = parts.length ? parts.join('\n\n') : null
      const image = screen.sharing ? screen.grabFrame() : null
      await feed.answer(q, mode, ctx, image, context.instructions || null)
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
    mode === 'coding' && screen.sharing && orchestrator.stage === 'idle' && !input.trim(),
    screen.grabFrame,
    (frame) => {
      if (streaming) return
      orchestrator.process(frame, context.instructions || null)
    },
  )

  // Tear the screen stream down when the panel closes.
  useEffect(() => () => { screen.stop(); me.stopListening() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the newest tokens as the answer streams in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  // Only this tab's thread — switching modes shows its own Q&A, not a shared one.
  const visibleTurns = turns.map((t, i) => ({ t, i })).filter(({ t }) => t.mode === mode)

  const submit = async (q: string) => {
    if (!q.trim() || streaming) return
    setInput('')
    // Attach a screen frame only when the user has screen-sharing on.
    const image = screen.sharing ? screen.grabFrame() : null
    // Ground the answer in this mode's uploaded context documents (RAG), if any.
    const retrieved = context.count > 0 ? await context.retrieve(q) : null
    ask(q, mode, image, retrieved, context.instructions || null)
  }

  return (
    <aside
      // Full-width on mobile; on ≥sm the width follows the drag-resized value
      // (--panel-w), so the drawer is user-resizable and the preference sticks.
      className="glass relative flex h-full w-full flex-col overflow-hidden border-l border-black/10 sm:w-[var(--panel-w)] sm:rounded-l-3xl"
      style={{ '--panel-w': `${width}px` } as CSSProperties}
    >
      {/* Left-edge resize handle (desktop only). Drag to widen/narrow the panel.
          A slim visible grabber marks it without changing the mouse cursor. */}
      <div
        onPointerDown={onResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize assistant panel"
        title="Drag to resize"
        className="absolute inset-y-0 left-0 z-10 hidden w-1.5 touch-none bg-black/10 hover:bg-emerald-700/30 sm:block"
      />
      <header className="flex items-center gap-2 border-b border-black/10 px-4 py-3">
        <Sparkles size={16} className="text-[color:var(--signal)]" />
        <span className="font-[family-name:var(--font-serif)] text-base font-semibold">Ask</span>
        <span className="hidden text-xs text-black/40 sm:inline">grounded in your transcript</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setAuto((v) => !v)}
            data-active={auto}
            title={auto ? 'Auto-answer is ON — questions heard are answered automatically' : 'Auto-answer questions from the meeting'}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-black/55 transition-colors hover:bg-black/5 data-[active=true]:bg-emerald-700/10 data-[active=true]:text-emerald-800"
          >
            <span className={auto ? 'live-dot' : 'hidden'} aria-hidden />
            <span className="hidden sm:inline">{auto ? 'Auto on' : 'Auto'}</span>
            <span className="sm:hidden">A</span>
          </button>
          <button
            onClick={() => (me.listening ? me.stopListening() : me.startListening())}
            data-active={me.listening}
            title={me.listening ? 'Mic on — what you say feeds the AI (never shown in the transcript)' : 'Add your voice as AI context (not transcribed)'}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-black/55 transition-colors hover:bg-black/5 data-[active=true]:bg-emerald-700/10 data-[active=true]:text-emerald-800"
          >
            {me.listening ? <Mic size={13} /> : <MicOff size={13} />}
            <span className="hidden sm:inline">{me.listening ? 'Mic (me)' : 'Mic'}</span>
          </button>
          <button
            onClick={() => (screen.sharing ? screen.stop() : screen.start())}
            data-active={screen.sharing}
            title={screen.sharing ? 'Stop sharing your screen' : 'Let the assistant see your screen'}
            className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-black/55 transition-colors hover:bg-black/5 data-[active=true]:bg-emerald-700/10 data-[active=true]:text-emerald-800"
          >
            {screen.sharing ? <Monitor size={13} /> : <MonitorOff size={13} />}
            <span className="hidden sm:inline">{screen.sharing ? 'Seeing screen' : 'See screen'}</span>
          </button>
          {/* Lock (click-through) mode — desktop only. Turning it ON makes the
              overlay pass clicks through to other apps; it can only be UNLOCKED via
              the global hotkey (⌘/Ctrl+Shift+L) or the tray, since a locked window
              can't be clicked. Button is view-only ON here. */}
          {lockMode.available && !lockMode.locked && (
            <button
              onClick={lockMode.enable}
              title="Lock (click-through): float on top and work in other apps. Unlock with ⌘/Ctrl+Shift+L or the tray."
              className="flex items-center gap-1 rounded-full px-2 py-1 text-xs text-black/55 transition-colors hover:bg-black/5"
            >
              <Lock size={13} />
              <span className="hidden sm:inline">Lock</span>
            </button>
          )}
          {turns.length > 0 && (
            <button onClick={clear} className="rounded-full px-2 py-1 text-xs text-black/45 hover:bg-black/5 hover:text-ink">
              Clear
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close assistant"
            className="flex h-9 w-9 items-center justify-center rounded-full text-black/40 hover:bg-black/5"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* Mode selector — per-domain answer styling (coding / system design /
          behavioral) on the same transcript grounding. */}
      <div className="flex gap-1 overflow-x-auto border-b border-black/10 px-3 py-2">
        {MODE_ORDER.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            data-active={mode === m}
            title={MODE_PROFILES[m].hint}
            className="shrink-0 rounded-full px-3 py-1 text-xs text-black/55 transition-colors hover:bg-black/5 data-[active=true]:bg-ink data-[active=true]:text-white"
          >
            {MODE_PROFILES[m].label}
          </button>
        ))}
      </div>

      {/* Chat vs Answers: the Answers feed holds auto-generated Q&A (proactive),
          paged prev/next — a separate view from the chat thread. */}
      <div className="flex items-center gap-1 border-b border-black/10 px-3 py-1.5 text-xs">
        <button
          onClick={() => setView('chat')}
          data-active={view === 'chat'}
          className="rounded-full px-2.5 py-1 text-black/55 data-[active=true]:bg-ink data-[active=true]:text-white"
        >
          Chat
        </button>
        <button
          onClick={() => setView('answers')}
          data-active={view === 'answers'}
          className="rounded-full px-2.5 py-1 text-black/55 data-[active=true]:bg-ink data-[active=true]:text-white"
        >
          Answers{feed.count > 0 ? ` (${feed.count})` : ''}
        </button>
      </div>

      {/* Context — upload documents + set instructions for how THIS mode's chat
          should answer. Separate per mode (coding/system design/behavioral/general
          each keep their own); chunked, embedded, and stored on this device. */}
      <div className="border-b border-black/10 bg-black/[0.02] px-4 py-2">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-black/55">
            {context.docs.length > 0 || context.instructions
              ? `Context: ${context.docs.length} doc${context.docs.length === 1 ? '' : 's'}${context.instructions ? ' · instructions set' : ''}`
              : 'No context yet — answers stay generic'}
          </span>
          <button
            onClick={() => setShowContextEditor((v) => !v)}
            className="ml-auto rounded-full px-2 py-0.5 text-emerald-800 hover:bg-emerald-700/10"
          >
            {showContextEditor ? 'Hide' : context.docs.length > 0 || context.instructions ? 'Edit' : 'Add context'}
          </button>
          {(context.docs.length > 0 || context.instructions) && (
            <button onClick={context.clear} className="rounded-full px-2 py-0.5 text-black/45 hover:bg-black/5">
              Clear
            </button>
          )}
        </div>
        {showContextEditor && <ContextEditor context={context} />}
      </div>

      {/* Visible privacy indicator — the assistant only sees your screen while
          this is showing, and only the frame at the moment you ask. */}
      {screen.sharing && (
        <div className="flex items-center gap-2 border-b border-emerald-700/15 bg-emerald-700/5 px-4 py-1.5 text-xs text-emerald-800">
          <span className="live-dot" aria-hidden />
          Sharing your screen — a frame is sent only when you ask.
        </div>
      )}
      {screen.error && <p className="border-b border-black/10 px-4 py-1.5 text-xs text-[color:var(--stop)]">{screen.error}</p>}

      {/* Orchestrator pipeline status (coding mode only) */}
      {mode === 'coding' && orchestrator.stage !== 'idle' && orchestrator.stage !== 'done' && (
        <OrchestratorStatus stage={orchestrator.stage} />
      )}
      {mode === 'coding' && orchestrator.problem && (
        <ExtractedProblemBar problem={orchestrator.problem} onDismiss={orchestrator.reset} />
      )}
      {mode === 'coding' && orchestrator.error && (
        <p className="border-b border-black/10 px-4 py-1.5 text-xs text-[color:var(--stop)]">{orchestrator.error}</p>
      )}

      {view === 'answers' ? (
        <AnswersView feed={feed} auto={auto} />
      ) : (
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {visibleTurns.length === 0 && !error && (
          <div className="pt-6 text-center">
            <p className="font-[family-name:var(--font-serif)] text-lg text-black/40">
              Ask anything about what&rsquo;s being said.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {QUICK_ACTIONS.map((a) => (
                <button
                  key={a}
                  onClick={() => submit(a)}
                  className="glass glass-interactive rounded-full px-3 py-2 text-sm text-black/70 hover:text-ink"
                >
                  {a}
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleTurns.map(({ t, i }) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-sm text-white">
                {t.content}
              </div>
            </div>
          ) : (
            <AssistantTurn
              key={i}
              content={t.content}
              streaming={streaming && i === turns.length - 1}
              autoTestResult={
                mode === 'coding' && i === autoTestTurn && orchestrator.testResult
                  ? orchestrator.testResult
                  : undefined
              }
            />
          ),
        )}

        {error && <p className="text-sm text-[color:var(--stop)]">{error}</p>}
      </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(input)
        }}
        className="flex items-center gap-2 border-t border-black/10 p-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={MODE_PROFILES[mode].hint + '…'}
          className="min-w-0 flex-1 rounded-full border border-black/15 bg-white/70 px-4 py-2.5 text-sm outline-none focus:border-emerald-700"
        />
        <button
          type="submit"
          disabled={!input.trim() || streaming}
          aria-label="Send"
          className="btn-signal flex h-11 w-11 shrink-0 items-center justify-center p-0 disabled:opacity-40"
        >
          <Send size={16} />
        </button>
      </form>
    </aside>
  )
}

// Upload documents (files or pasted text) + set answer instructions for the
// active mode's chat. Files are read client-side, chunked + embedded on add;
// nothing persists server-side — vectors live in this device's localStorage.
function ContextEditor({ context }: { context: ReturnType<typeof useModeContext> }) {
  const [pasteText, setPasteText] = useState('')
  const [instructionsDraft, setInstructionsDraft] = useState(context.instructions)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Documents list collapses so a long list of uploads doesn't push the composer
  // off-screen. Default open only when there's nothing yet (nudge to add).
  const [docsOpen, setDocsOpen] = useState(true)

  // Switching modes swaps the whole context object — keep the draft in sync.
  useEffect(() => setInstructionsDraft(context.instructions), [context.instructions])

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
      <div>
        <label className="text-[11px] font-medium uppercase tracking-wide text-black/40">Instructions</label>
        <textarea
          value={instructionsDraft}
          onChange={(e) => setInstructionsDraft(e.target.value)}
          onBlur={saveInstructions}
          rows={3}
          placeholder="How should this chat answer? e.g. &quot;Cite the section number&quot;, &quot;Keep answers under 3 sentences&quot;…"
          className="mt-1 w-full rounded-lg border border-black/15 bg-white/80 p-2 text-xs outline-none focus:border-emerald-700"
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
            accept=".txt,.md,text/plain,text/markdown"
            multiple
            onChange={(e) => onFiles(e.target.files)}
            className="hidden"
          />
          <span className="text-[11px] text-black/40">.txt / .md · stored on this device</span>
        </div>
        <div className="mt-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={3}
            placeholder="…or paste text to add as a document"
            className="w-full rounded-lg border border-black/15 bg-white/80 p-2 text-xs outline-none focus:border-emerald-700"
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
    if (el.scrollHeight <= el.clientHeight) return // nothing to scroll

    let cancelled = false
    let last = 0
    const SPEED = 24 // px per second — unhurried reading pace
    let raf = 0
    const step = (t: number) => {
      if (cancelled) return
      if (last) {
        const next = el.scrollTop + (SPEED * (t - last)) / 1000
        el.scrollTop = next
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

// The navigable auto-answer feed: one Q&A card at a time, paged prev/next.
function AnswersView({
  feed,
  auto,
}: {
  feed: ReturnType<typeof useAnswerFeed>
  auto: boolean
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
      <div className="flex-1 overflow-y-auto px-4 py-8 text-center">
        <p className="font-[family-name:var(--font-serif)] text-lg text-black/40">
          {auto ? 'Listening… answers to questions will appear here.' : 'Turn on Auto to auto-answer questions from the meeting.'}
        </p>
      </div>
    )
  }
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-black/10 px-4 py-2 text-xs text-black/50">
        <button onClick={feed.prev} disabled={feed.cursor === 0} className="rounded-full p-1 hover:bg-black/5 disabled:opacity-30" aria-label="Previous">
          <ChevronLeft size={16} />
        </button>
        <span className="tabular-nums">{feed.cursor + 1} / {feed.count}</span>
        <button onClick={feed.next} disabled={feed.cursor >= feed.count - 1} className="rounded-full p-1 hover:bg-black/5 disabled:opacity-30" aria-label="Next">
          <ChevronRight size={16} />
        </button>
        {e?.failed && (
          <button onClick={() => feed.retry(e.id)} className="rounded-full px-2 py-1 text-emerald-800 hover:bg-emerald-700/10" title="Retry this answer">
            Retry
          </button>
        )}
        <button onClick={feed.clear} className="ml-auto rounded-full px-2 py-1 text-black/45 hover:bg-black/5 hover:text-ink">Clear</button>
      </div>
      <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-[color:var(--signal)]">Question</div>
        <p className="text-sm font-medium text-ink">{e?.question}</p>
        <div className="text-xs font-medium uppercase tracking-wide text-black/40">Answer</div>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
          {e?.answer}
          {e?.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[color:var(--signal)] align-middle" aria-hidden />}
        </div>
        {e?.failed && !e.streaming && (
          <p className="text-xs text-[color:var(--stop)]">The assistant didn&rsquo;t respond. Tap Retry above.</p>
        )}
      </div>
    </div>
  )
}

function AssistantTurn({
  content,
  streaming,
  autoTestResult,
}: {
  content: string
  streaming: boolean
  autoTestResult?: TestRunResult
}) {
  const [result, setResult] = useState<RunResult | null>(null)
  const [testResult, setTestResult] = useState<TestRunResult | null>(null)
  const [running, setRunning] = useState(false)
  const codeBlock = streaming ? null : extractCode(content)
  const testsBlock = streaming ? null : extractTests(content)

  const displayTestResult = testResult ?? autoTestResult ?? null

  const run = async () => {
    if (!codeBlock) return
    setRunning(true)
    setResult(null)
    setTestResult(null)
    if (testsBlock && canExecute(testsBlock.language)) {
      setTestResult(await executeTests(codeBlock.code, testsBlock.tests, testsBlock.language))
    } else if (canExecute(codeBlock.language)) {
      setResult(await executeCode(codeBlock.code, codeBlock.language))
    }
    setRunning(false)
  }

  const executable = codeBlock && canExecute(codeBlock.language)

  return (
    <div className="flex flex-col items-start gap-2">
      <RichContent content={content} streaming={streaming} />
      {codeBlock && executable && (
        <div className="w-full">
          {!autoTestResult && (
            <button
              onClick={run}
              disabled={running}
              className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-50"
              title={testsBlock ? `Run ${codeBlock.language} tests in sandbox` : `Run ${codeBlock.language} in sandbox`}
            >
              <Play size={12} /> {running ? 'Running…' : testsBlock ? 'Run tests' : 'Run code'}
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

// Renders assistant content with inline Mermaid diagrams.
function RichContent({ content, streaming }: { content: string; streaming: boolean }) {
  const parts = content.split(/(```mermaid\n[\s\S]*?```)/g)

  return (
    <div className="max-w-[92%] whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
      {parts.map((part, i) => {
        const mermaidMatch = part.match(/```mermaid\n([\s\S]*?)```/)
        if (mermaidMatch) {
          return <MermaidDiagram key={i} code={mermaidMatch[1].trim()} />
        }
        return <span key={i}>{part}</span>
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
