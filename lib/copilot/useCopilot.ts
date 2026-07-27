'use client'
import { useCallback, useRef, useState } from 'react'
import { captureLatency } from './latency'

// Copilot chat state + streaming. Sends the question + transcript tail to
// /api/copilot/answer and appends streamed tokens to the latest assistant turn.
// A new question aborts the prior stream (AbortController) so a stale answer
// never races the current one.
//
// Each turn is tagged with the MODE it was asked in, so each tab (general /
// coding / systemDesign / behavioral) shows its OWN thread — switching tabs
// doesn't leak one mode's Q&A into another.
export type CopilotTurn = { role: 'user' | 'assistant'; content: string; mode: string }

// Stall failsafe: abort if no FIRST token arrives in this window, or if a gap
// between tokens exceeds TOKEN_GAP_MS — so a stuck stream surfaces an error +
// retry instead of hanging the chat forever.
const STALL_TIMEOUT_MS = 20_000
const TOKEN_GAP_MS = 15_000

export function useCopilot(getTranscript: () => string) {
  const [turns, setTurns] = useState<CopilotTurn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Keep the freshest transcript getter without recreating ask() each render.
  const transcriptRef = useRef(getTranscript)
  transcriptRef.current = getTranscript

  const ask = useCallback(
    async (
      question: string,
      mode: string = 'general',
      image?: string | null,
      context?: string | null,
      instructions?: string | null,
    ) => {
      const q = question.trim()
      if (!q) return
      // Cancel any in-flight answer before starting a new one.
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl
      setError(null)

      // Failsafe: abort if the assistant stalls (no first token / a long token
      // gap) so a stuck request can't hang the chat forever. `stalled` lets the
      // catch tell a timeout apart from a user-superseded request.
      let stalled = false
      let watchdog: ReturnType<typeof setTimeout> | undefined
      const arm = (ms: number) => {
        clearTimeout(watchdog)
        watchdog = setTimeout(() => {
          stalled = true
          ctrl.abort()
        }, ms)
      }

      // History = prior turns in the SAME mode (each tab is its own thread).
      const history = turns.filter((t) => t.mode === mode).slice(-8).map(({ role, content }) => ({ role, content }))
      setTurns((t) => [...t, { role: 'user', content: q, mode }, { role: 'assistant', content: '', mode }])
      setStreaming(true)
      arm(STALL_TIMEOUT_MS)

      let finalContent = ''
      // Latency span: request start → first token (ttft) → completion (total).
      const startedAt = performance.now()
      let firstTokenAt: number | null = null
      try {
        const res = await fetch('/api/copilot/answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: q,
            transcript: transcriptRef.current(),
            history,
            mode,
            image: image ?? undefined,
            context: context ?? undefined,
            instructions: instructions ?? undefined,
          }),
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
          if (text) {
            if (firstTokenAt === null) firstTokenAt = performance.now()
            arm(TOKEN_GAP_MS) // reset the stall timer on every token
          }
          finalContent += text
          setTurns((t) => {
            const next = t.slice()
            const last = next[next.length - 1]
            if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + text }
            return next
          })
        }
        clearTimeout(watchdog)
        captureLatency(mode, startedAt, firstTokenAt, finalContent)
      } catch (e) {
        clearTimeout(watchdog)
        // A user-superseded abort returns silently; a STALL abort surfaces an error.
        if ((e as Error).name === 'AbortError' && !stalled) return
        setError(stalled ? 'The assistant timed out — please retry.' : e instanceof Error ? e.message : 'Assistant failed')
        // Drop the empty assistant placeholder so a failed turn doesn't linger.
        setTurns((t) =>
          t[t.length - 1]?.role === 'assistant' && !t[t.length - 1].content ? t.slice(0, -1) : t,
        )
      } finally {
        if (abortRef.current === ctrl) setStreaming(false)
      }
      return finalContent || undefined
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
