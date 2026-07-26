'use client'
import { useCallback, useRef, useState } from 'react'

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

export function useAnswerFeed() {
  const [entries, setEntries] = useState<AnswerEntry[]>([])
  const [cursor, setCursor] = useState(0) // which entry the feed view is showing
  const idRef = useRef(0)
  // Remember each entry's request args so Retry can re-run the exact same ask.
  const argsRef = useRef<Map<number, { mode: string; meContext: string | null; image: string | null; instructions?: string | null }>>(
    new Map(),
  )

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
    ): Promise<boolean> => {
      const ctrl = new AbortController()
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const arm = (ms: number) => {
        clearTimeout(watchdog)
        watchdog = setTimeout(() => ctrl.abort(), ms)
      }
      arm(STALL_TIMEOUT_MS)
      let gotAny = false
      setEntries((e) => e.map((x) => (x.id === id ? { ...x, answer: '' } : x)))
      try {
        const res = await fetch('/api/copilot/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question,
            transcript: '', // the question itself carries the ask; context below
            mode,
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
            gotAny = true
            arm(TOKEN_GAP_MS) // reset the stall timer on every token
            setEntries((e) => e.map((x) => (x.id === id ? { ...x, answer: x.answer + text } : x)))
          }
        }
        clearTimeout(watchdog)
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
    ) => {
      for (let i = 0; i <= MAX_AUTO_RETRIES; i++) {
        if (i > 0) {
          // Show a "Retrying…" state and wait out the backoff before re-attempting.
          setEntries((e) => e.map((x) => (x.id === id ? { ...x, retrying: true, streaming: true } : x)))
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS[i - 1] ?? 2500))
        }
        const ok = await attempt(id, question, mode, meContext, image, instructions)
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
    ) => {
      const id = ++idRef.current
      argsRef.current.set(id, { mode, meContext, image, instructions })
      setEntries((e) => {
        const next = [...e, { id, question, answer: '', streaming: true, retrying: false, failed: false }]
        setCursor(next.length - 1) // jump the view to the newest (array index, not id)
        return next
      })
      await run(id, question, mode, meContext, image, instructions)
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
      void run(id, entry.question, args.mode, args.meContext, args.image, args.instructions)
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

  const current = entries[Math.min(cursor, entries.length - 1)] ?? null
  return { entries, current, cursor, count: entries.length, answer, retry, clear, prev, next }
}
