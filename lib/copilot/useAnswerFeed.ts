'use client'
import { useCallback, useRef, useState } from 'react'
import { captureLatency } from './latency'

// A SEPARATE, navigable feed of auto-generated answers (distinct from the chat
// thread). Each detected question becomes one entry {question, answer} that
// streams in; the UI can page prev/next through them. Used by proactive mode:
// a question heard from the system speaker → an answer generated here.
export type AnswerEntry = {
  id: number
  question: string
  answer: string
  streaming: boolean
  // True between auto-retry attempts, so the UI can say "Retrying…" instead of
  // looking stuck or prematurely failed.
  retrying: boolean
  // Set only after ALL auto-retries are exhausted. The UI then shows a manual
  // Retry button as the last resort — the orchestrator has already tried itself.
  failed: boolean
}

// If no first token arrives within this window, treat the request as stuck and
// (auto-)retry rather than spinning forever. Generous enough for a cold model +
// long prompt, short enough that the user isn't left hanging.
const STALL_TIMEOUT_MS = 20_000
// Once streaming, a gap this long between tokens means the stream stalled.
const TOKEN_GAP_MS = 15_000
// Auto-retry: the orchestrator retries a failed/stalled answer itself before ever
// surfacing the manual button. Backoff between attempts so we don't hammer a
// briefly-down provider.
const MAX_AUTO_RETRIES = 2
const RETRY_BACKOFF_MS = [800, 2500]

// How many prior same-mode Q&A pairs to feed back as history. Enough for the model
// to see which behavioral stories it already used (no-reuse) without bloating the
// prompt — each prior answer is capped server-side anyway.
const HISTORY_TURNS = 6

export function useAnswerFeed() {
  const [entries, setEntries] = useState<AnswerEntry[]>([])
  const [cursor, setCursor] = useState(0) // which entry the feed view is showing
  const idRef = useRef(0)
  // Remember each entry's request args so Retry can re-run the exact same ask.
  const argsRef = useRef<Map<number, { mode: string; meContext: string | null; image: string | null; instructions?: string | null; transcript?: string | null }>>(
    new Map(),
  )
  // Mirror entries in a ref so attempt() can build history from PRIOR answers
  // without adding itself as a dep (which would recreate the callback each token).
  const entriesRef = useRef<AnswerEntry[]>([])
  entriesRef.current = entries

  // Prior finished Q&A in the SAME mode, oldest-first, as chat history — so the
  // model remembers which stories it already spent (behavioral no-reuse) and keeps
  // continuity. Excludes the current entry, streaming/failed ones, and empties.
  const buildHistory = (currentId: number, mode: string): { role: 'user' | 'assistant'; content: string }[] => {
    const turns: { role: 'user' | 'assistant'; content: string }[] = []
    for (const e of entriesRef.current) {
      if (e.id >= currentId || e.streaming || e.failed || !e.answer.trim()) continue
      if (argsRef.current.get(e.id)?.mode !== mode) continue
      turns.push({ role: 'user', content: e.question }, { role: 'assistant', content: e.answer })
    }
    return turns.slice(-HISTORY_TURNS * 2)
  }

  // One streaming attempt. Returns true if it produced any tokens, false on
  // error/stall/empty — the caller decides whether to auto-retry. Resets the
  // entry's answer text at the start so a retry doesn't append to a partial.
  const attempt = useCallback(
    async (
      id: number,
      question: string,
      mode: string,
      meContext: string | null,
      image: string | null,
      instructions?: string | null,
      transcript?: string | null,
    ): Promise<boolean> => {
      const ctrl = new AbortController()
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const arm = (ms: number) => {
        clearTimeout(watchdog)
        watchdog = setTimeout(() => ctrl.abort(), ms)
      }
      arm(STALL_TIMEOUT_MS)
      let gotAny = false
      // Latency span: request start → first token (ttft) → completion (total).
      const startedAt = performance.now()
      let firstTokenAt: number | null = null
      let raw = ''
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, answer: '' } : x)))
      try {
        const res = await fetch('/api/copilot/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            // Ground the auto-answer in what was actually said (server caps + tails
            // it). Was '' — proactive answers were ungrounded, hurting quality.
            transcript: transcript ?? '',
            mode,
            // Prior same-mode answers as history so the model won't reuse a
            // behavioral story across questions and keeps continuity on follow-ups.
            history: buildHistory(id, mode),
            image: image ?? undefined,
            context: meContext ?? undefined,
            instructions: instructions ?? undefined,
          }),
          signal: ctrl.signal,
        })
        if (!res.ok || !res.body) throw new Error('Assistant unavailable')
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const text = dec.decode(value, { stream: true })
          if (text) {
            if (firstTokenAt === null) firstTokenAt = performance.now()
            gotAny = true
            raw += text
            arm(TOKEN_GAP_MS) // reset the stall timer on every token
            setEntries((e) => e.map((x) => (x.id === id ? { ...x, answer: x.answer + text } : x)))
          }
        }
        clearTimeout(watchdog)
        captureLatency(mode, startedAt, firstTokenAt, raw)
        return gotAny // empty-but-OK stream counts as a non-answer → retryable
      } catch {
        clearTimeout(watchdog)
        return false
      }
    },
    [],
  )

  // Run an answer with automatic retries: the orchestrator retries a failed/
  // stalled attempt itself (with backoff) before ever showing the manual button.
  const run = useCallback(
    async (
      id: number,
      question: string,
      mode: string,
      meContext: string | null,
      image: string | null,
      instructions?: string | null,
      transcript?: string | null,
    ) => {
      for (let i = 0; i <= MAX_AUTO_RETRIES; i++) {
        if (i > 0) {
          // Show a "Retrying…" state and wait out the backoff before re-attempting.
          setEntries((e) => e.map((x) => (x.id === id ? { ...x, retrying: true, streaming: true } : x)))
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[i - 1] ?? 2500))
        }
        const ok = await attempt(id, question, mode, meContext, image, instructions, transcript)
        if (ok) {
          setEntries((e) => e.map((x) => (x.id === id ? { ...x, streaming: false, retrying: false, failed: false } : x)))
          return
        }
      }
      // All auto-retries exhausted → surface the manual Retry button as last resort.
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, streaming: false, retrying: false, failed: true } : x)))
    },
    [attempt],
  )

  // Generate an answer for a heard question, streaming into a new entry.
  const answer = useCallback(
    async (
      question: string,
      mode: string,
      meContext: string | null,
      image: string | null,
      instructions?: string | null,
      transcript?: string | null,
    ) => {
      const id = ++idRef.current
      argsRef.current.set(id, { mode, meContext, image, instructions, transcript })
      setEntries((e) => {
        const next = [...e, { id, question, answer: '', streaming: true, retrying: false, failed: false }]
        // Only follow to the newest card if the user was ALREADY on the last one.
        // If they've paged back to re-read an earlier answer, don't yank the view
        // out from under them mid-sentence — the count badge signals a new answer.
        setCursor((c) => (c >= e.length - 1 ? next.length - 1 : c))
        return next
      })
      await run(id, question, mode, meContext, image, instructions, transcript)
    },
    [run],
  )

  // Re-run a failed/stuck entry with its original args, in place.
  const retry = useCallback(
    (id: number) => {
      const entry = entries.find((x) => x.id === id)
      const args = argsRef.current.get(id)
      if (!entry || !args) return
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, answer: '', streaming: true, retrying: false, failed: false } : x)))
      void run(id, entry.question, args.mode, args.meContext, args.image, args.instructions, args.transcript)
    },
    [entries, run],
  )

  const clear = useCallback(() => {
    setEntries([])
    setCursor(0)
    argsRef.current.clear()
  }, [])
  const prev = useCallback(() => setCursor((c) => Math.max(0, c - 1)), [])
  // Clamp to the array's last index (entries.length - 1), not the id counter —
  // ids keep climbing across clears, array length resets.
  const next = useCallback(() => setCursor((c) => Math.min(entries.length - 1, c + 1)), [entries.length])

  // The questions asked this session with their (auto-routed) mode — for the
  // post-interview review. Reads mode from the per-entry args recorded at ask time.
  const questions = useCallback(
    (): { q: string; mode: string }[] =>
      entries.map((e) => ({ q: e.question, mode: argsRef.current.get(e.id)?.mode ?? 'general' })),
    [entries],
  )

  const current = entries[Math.min(cursor, entries.length - 1)] ?? null
  return { entries, current, cursor, count: entries.length, answer, retry, clear, prev, next, questions }
}
