'use client'
import { useCallback, useRef, useState } from 'react'

// A SEPARATE, navigable feed of auto-generated answers (distinct from the chat
// thread). Each detected question becomes one entry {question, answer} that
// streams in; the UI can page prev/next through them. Used by proactive mode:
// a question heard from the system speaker → an answer generated here.
export type AnswerEntry = { id: number; question: string; answer: string; streaming: boolean }

export function useAnswerFeed() {
  const [entries, setEntries] = useState<AnswerEntry[]>([])
  const [cursor, setCursor] = useState(0) // which entry the feed view is showing
  const idRef = useRef(0)

  // Generate an answer for a heard question, streaming into a new entry.
  // `meContext` = what the user said (mic) — grounds the answer without being
  // shown in the transcript.
  const answer = useCallback(
    async (
      question: string,
      mode: string,
      meContext: string | null,
      image: string | null,
      instructions?: string | null,
    ) => {
      const id = ++idRef.current
      setEntries((e) => [...e, { id, question, answer: '', streaming: true }])
      setCursor(() => idRef.current - 1) // jump the view to the newest
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
        })
        if (!res.ok || !res.body) throw new Error('Assistant unavailable')
        const reader = res.body.getReader()
        const dec = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const text = dec.decode(value, { stream: true })
          setEntries((e) => e.map((x) => (x.id === id ? { ...x, answer: x.answer + text } : x)))
        }
      } catch {
        setEntries((e) => e.map((x) => (x.id === id ? { ...x, answer: x.answer || '(could not answer)' } : x)))
      } finally {
        setEntries((e) => e.map((x) => (x.id === id ? { ...x, streaming: false } : x)))
      }
    },
    [],
  )

  const clear = useCallback(() => {
    setEntries([])
    setCursor(0)
  }, [])
  const prev = useCallback(() => setCursor((c) => Math.max(0, c - 1)), [])
  const next = useCallback(() => setCursor((c) => Math.min(idRef.current - 1, c + 1)), [])

  const current = entries[Math.min(cursor, entries.length - 1)] ?? null
  return { entries, current, cursor, count: entries.length, answer, clear, prev, next }
}
