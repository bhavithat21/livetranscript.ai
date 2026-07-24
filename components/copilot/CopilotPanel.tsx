'use client'
import { useEffect, useRef, useState } from 'react'
import { Send, Sparkles, X } from 'lucide-react'
import { useCopilot } from '@/lib/copilot/useCopilot'

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
  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // Follow the newest tokens as the answer streams in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  const submit = (q: string) => {
    if (!q.trim() || streaming) return
    ask(q)
    setInput('')
  }

  return (
    <aside className="glass flex h-full w-full flex-col overflow-hidden border-l border-black/10 sm:rounded-l-3xl">
      <header className="flex items-center gap-2 border-b border-black/10 px-4 py-3">
        <Sparkles size={16} className="text-[color:var(--signal)]" />
        <span className="font-[family-name:var(--font-serif)] text-base font-semibold">Ask</span>
        <span className="hidden text-xs text-black/40 sm:inline">grounded in your transcript</span>
        <div className="ml-auto flex items-center gap-1">
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

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
        {turns.length === 0 && !error && (
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

        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-ink px-3.5 py-2 text-sm text-white">
                {t.content}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[92%] whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
                {t.content}
                {streaming && i === turns.length - 1 && (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-[color:var(--signal)] align-middle" aria-hidden />
                )}
              </div>
            </div>
          ),
        )}

        {error && <p className="text-sm text-[color:var(--stop)]">{error}</p>}
      </div>

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
          placeholder="Ask about the transcript…"
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
