'use client'
import { useEffect, useRef, useState } from 'react'
import { Check, Monitor, MonitorOff, Play, Send, Sparkles, X } from 'lucide-react'
import { useCopilot } from '@/lib/copilot/useCopilot'
import { useScreenStream } from '@/lib/vision/useScreenStream'
import { useStoryBank } from '@/lib/copilot/useStoryBank'
import { useProactive } from '@/lib/copilot/useProactive'
import { useAnswerFeed } from '@/lib/copilot/useAnswerFeed'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
  const bank = useStoryBank()
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<CopilotMode>('general')
  const feed = useAnswerFeed()
  const [showBankEditor, setShowBankEditor] = useState(false)
  const [auto, setAuto] = useState(false)
  const [view, setView] = useState<'chat' | 'answers'>('chat')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Proactive: while auto is on, questions heard in the transcript are answered
  // automatically into the SEPARATE navigable answer feed (not the chat thread).
  // Behavioral pulls the story-bank; a screen frame attaches if sharing is on.
  useProactive(auto, getTranscript, (q) => {
    setView('answers') // surface the feed as answers arrive
    void (async () => {
      const ctx = mode === 'behavioral' && bank.count > 0 ? await bank.retrieve(q) : null
      const image = screen.sharing ? screen.grabFrame() : null
      feed.answer(q, mode, ctx, image)
    })()
  })

  // Tear the screen stream down when the panel closes.
  useEffect(() => () => screen.stop(), []) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Behavioral mode: ground the answer in the user's OWN matched story (RAG).
    const context = mode === 'behavioral' && bank.count > 0 ? await bank.retrieve(q) : null
    ask(q, mode, image, context)
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

      {/* Behavioral story-bank — paste resume/STAR stories once; answers ground in
          YOUR real history (the personalization moat). Stored on this device. */}
      {mode === 'behavioral' && (
        <div className="border-b border-black/10 bg-black/[0.02] px-4 py-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-black/55">
              {bank.count > 0 ? `Your background: ${bank.count} snippets loaded` : 'No background yet — answers stay generic'}
            </span>
            <button
              onClick={() => setShowBankEditor((v) => !v)}
              className="ml-auto rounded-full px-2 py-0.5 text-emerald-800 hover:bg-emerald-700/10"
            >
              {bank.count > 0 ? 'Edit' : 'Add your background'}
            </button>
            {bank.count > 0 && (
              <button onClick={bank.clear} className="rounded-full px-2 py-0.5 text-black/45 hover:bg-black/5">
                Clear
              </button>
            )}
          </div>
          {showBankEditor && (
            <StoryBankEditor
              saving={bank.saving}
              error={bank.error}
              onSave={async (text) => {
                await bank.save(text)
                setShowBankEditor(false)
              }}
            />
          )}
        </div>
      )}

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

// Paste-and-save editor for the behavioral story-bank. Text is chunked + embedded
// on save; nothing persists server-side.
function StoryBankEditor({
  saving,
  error,
  onSave,
}: {
  saving: boolean
  error: string | null
  onSave: (text: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <div className="mt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        placeholder="Paste your resume and a few STAR stories (separate stories with a blank line)…"
        className="w-full rounded-lg border border-black/15 bg-white/80 p-2 text-xs outline-none focus:border-emerald-700"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          onClick={() => onSave(text)}
          disabled={saving || !text.trim()}
          className="btn-signal px-3 py-1.5 text-xs disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save to this device'}
        </button>
        <span className="text-[11px] text-black/40">Stored locally · used only to ground your answers</span>
      </div>
      {error && <p className="mt-1 text-xs text-[color:var(--stop)]">{error}</p>}
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
