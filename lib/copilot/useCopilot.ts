'use client'
import { useCallback, useRef, useState } from 'react'

// Copilot chat state + streaming. Sends the question + transcript tail to
// /api/copilot/answer and appends streamed tokens to the latest assistant turn.
// A new question aborts the prior stream (AbortController) so a stale answer
// never races the current one.
export type CopilotTurn = { role: 'user' | 'assistant'; content: string }

export function useCopilot(getTranscript: () => string) {
  const [turns, setTurns] = useState<CopilotTurn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Keep the freshest transcript getter without recreating ask() each render.
  const transcriptRef = useRef(getTranscript)
  transcriptRef.current = getTranscript

  const ask = useCallback(
    async (question: string, mode?: string, image?: string | null) => {
      const q = question.trim()
      if (!q) return
      // Cancel any in-flight answer before starting a new one.
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setError(null)

      // History = prior turns BEFORE this question (bounded server-side too).
      const history = turns.slice(-8)
      setTurns((t) => [...t, { role: 'user', content: q }, { role: 'assistant', content: '' }])
      setStreaming(true)

      try {
        const res = await fetch('/api/copilot/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, transcript: transcriptRef.current(), history, mode, image: image ?? undefined }),
          signal: ctrl.signal,
        })
        if (!res.ok || !res.body) {
          throw new Error(res.status === 401 ? 'Sign in to use the assistant' : 'Assistant unavailable')
        }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const text = decoder.decode(value, { stream: true })
          setTurns((t) => {
            const next = t.slice()
            const last = next[next.length - 1]
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + text }
            return next
          })
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') return // superseded by a newer question
        setError(e instanceof Error ? e.message : 'Assistant failed')
        // Drop the empty assistant placeholder so a failed turn doesn't linger.
        setTurns((t) =>
          t[t.length - 1]?.role === 'assistant' && !t[t.length - 1].content ? t.slice(0, -1) : t,
        )
      } finally {
        if (abortRef.current === ctrl) setStreaming(false)
      }
    },
    [turns],
  )

  const clear = useCallback(() => {
    abortRef.current?.abort()
    setTurns([])
    setError(null)
  }, [])

  return { turns, streaming, error, ask, clear }
}
