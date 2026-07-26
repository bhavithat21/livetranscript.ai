'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, MonitorOff, Play, Send, Sparkles, X } from 'lucide-react'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { useScreenStream } from '@/lib/vision/useScreenStream'
import { useModeContext } from '@/lib/copilot/useModeContext'
import { useProactive } from '@/lib/copilot/useProactive'
import { useAnswerFeed } from '@/lib/copilot/useAnswerFeed'
import { useMeContext } from '@/lib/copilot/useMeContext'
import { ChevronLeft, ChevronRight, Mic, MicOff } from 'lucide-react'
import { MODE_ORDER, MODE_PROFILES, type CopilotMode } from '@/lib/copilot/modes'
import { extractPython, runPython, type RunResult } from '@/lib/copilot/pyodideRunner'

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
}: {
  getTranscript: () => string
  onClose: () => void
}) {
  const { turns, streaming, error, ask, clear } = useCopilot(getTranscript)
  const screen = useScreenStream()
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<CopilotMode>('general')
  const context = useModeContext(mode) // per-mode uploaded documents + answer instructions
  const feed = useAnswerFeed()
  const me = useMeContext() // opt-in mic stream: "what I said" as AI context, never in transcript
  const [showContextEditor, setShowContextEditor] = useState(false)
  const [auto, setAuto] = useState(false)
  const [view, setView] = useState<'chat' | 'answers'>('chat')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Proactive: while auto is on, questions heard in the transcript are answered
  // automatically into the SEPARATE navigable answer feed (not the chat thread).
  // Pulls this mode's uploaded-document context; a screen frame attaches if
  // sharing is on.
  useProactive(auto, getTranscript, (q) => {
    setView('answers') // surface the feed as answers arrive
    void (async () => {
      const retrieved = context.count > 0 ? await context.retrieve(q) : null
      // Combine what YOU said (mic context, if listening) with any matched context
      // document chunk — grounds the answer without either appearing in the transcript.
      const parts = [me.getMeContext() && `What I said: ${me.getMeContext()}`, retrieved].filter(Boolean)
      const ctx = parts.length ? parts.join('\n\n') : null
      const image = screen.sharing ? screen.grabFrame() : null
      feed.answer(q, mode, ctx, image, context.instructions || null)
    })()
  })

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
    <aside className="glass flex h-full w-full flex-col overflow-hidden border-l border-black/10 sm:rounded-l-3xl">
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

  // Switching modes swaps the whole context object — keep the draft in sync.
  useEffect(() => setInstructionsDraft(context.instructions), [context.instructions])

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
          onBlur={() => context.setInstructions(instructionsDraft)}
          rows={3}
          placeholder="How should this chat answer? e.g. &quot;Cite the section number&quot;, &quot;Keep answers under 3 sentences&quot;…"
          className="mt-1 w-full rounded-lg border border-black/15 bg-white/80 p-2 text-xs outline-none focus:border-emerald-700"
        />
      </div>

      <div>
        <label className="text-[11px] font-medium uppercase tracking-wide text-black/40">Documents</label>
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
      </div>
    </div>
  )
}

// The navigable auto-answer feed: one Q&A card at a time, paged prev/next.
function AnswersView({
  feed,
  auto,
}: {
  feed: ReturnType<typeof useAnswerFeed>
  auto: boolean
}) {
  if (feed.count === 0) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-8 text-center">
        <p className="font-[family-name:var(--font-serif)] text-lg text-black/40">
          {auto ? 'Listening… answers to questions will appear here.' : 'Turn on Auto to auto-answer questions from the meeting.'}
        </p>
      </div>
    )
  }
  const e = feed.current
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
        <button onClick={feed.clear} className="ml-auto rounded-full px-2 py-1 text-black/45 hover:bg-black/5 hover:text-ink">Clear</button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        <div className="text-xs font-medium uppercase tracking-wide text-[color:var(--signal)]">Question</div>
        <p className="text-sm font-medium text-ink">{e?.question}</p>
        <div className="text-xs font-medium uppercase tracking-wide text-black/40">Answer</div>
        <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
          {e?.answer}
          {e?.streaming && <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[color:var(--signal)] align-middle" aria-hidden />}
        </div>
      </div>
    </div>
  )
}

// One assistant answer. If it contains a Python block, offer to RUN it in the
// browser sandbox (Pyodide) — execution-verified correctness, the coding edge.
function AssistantTurn({ content, streaming }: { content: string; streaming: boolean }) {
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)
  // Only offer Run once the answer has finished streaming (code is complete).
  const code = streaming ? null : extractPython(content)

  const run = async () => {
    if (!code) return
    setRunning(true)
    setResult(null)
    setResult(await runPython(code))
    setRunning(false)
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <div className="max-w-[92%] whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
        {content}
        {streaming && (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[color:var(--signal)] align-middle" aria-hidden />
        )}
      </div>
      {code && (
        <div className="w-full">
          <button
            onClick={run}
            disabled={running}
            className="btn-ghost flex items-center gap-1.5 text-xs disabled:opacity-50"
            title="Run the Python in a sandbox to verify it"
          >
            <Play size={12} /> {running ? 'Running…' : 'Run code'}
          </button>
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
