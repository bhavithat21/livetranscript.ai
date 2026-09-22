'use client'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { captureLatency } from './latency'
import { CopilotCalibrationContext } from '@/lib/interview/TuningContext'

export type CopilotTurn = { role: 'user' | 'assistant'; content: string; mode: string }
const STALL_TIMEOUT_MS = 20_000
const TOKEN_GAP_MS = 15_000

// One transport for Live and Mock. Mock changes input/context, not generation.
// Snapshot configuration per request; later edits cannot relabel an in-flight run.
export function useCopilot(getTranscript: () => string) {
  const [turns, setTurns] = useState<CopilotTurn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const transcriptRef = useRef(getTranscript)
  transcriptRef.current = getTranscript
  const calibration = useContext(CopilotCalibrationContext)
  const calibrationRef = useRef(calibration)
  calibrationRef.current = calibration
  useEffect(() => () => { abortRef.current?.abort(); abortRef.current = null }, [])

  const ask = useCallback(async (
    question: string, mode: string = 'general', image?: string | null,
    context?: string | null, instructions?: string | null,
  ) => {
    const q = question.trim()
    if (!q) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const settings = calibrationRef.current
    const transcript = transcriptRef.current()
    setError(null)
    let stalled = false
    let watchdog: ReturnType<typeof setTimeout> | undefined
    const arm = (ms: number) => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => { stalled = true; ctrl.abort() }, ms)
    }
    const history = turns.filter((t) => t.mode === mode).slice(-8).map(({ role, content }) => ({ role, content }))
    setTurns((t) => [...t, { role: 'user', content: q, mode }, { role: 'assistant', content: '', mode }])
    setStreaming(true)
    settings?.onRunning?.(true)
    arm(STALL_TIMEOUT_MS)
    let finalContent = ''
    let failure: string | undefined
    const startedAt = performance.now()
    let firstTokenAt: number | null = null
    try {
      const res = await fetch('/api/copilot/answer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, transcript, history, mode, image: image ?? undefined,
          context: context ?? undefined, instructions: instructions ?? undefined,
          calibration: settings?.instructions || undefined }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) throw new Error(res.status === 401 ? 'Sign in to use the assistant' : 'Assistant unavailable')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (ctrl.signal.aborted || abortRef.current !== ctrl) return
        if (done) break
        const text = decoder.decode(value, { stream: true })
        if (text) {
          if (firstTokenAt === null) firstTokenAt = performance.now()
          arm(TOKEN_GAP_MS)
        }
        finalContent += text
        setTurns((t) => {
          if (abortRef.current !== ctrl) return t
          const next = t.slice()
          const last = next[next.length - 1]
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: last.content + text }
          return next
        })
      }
      if (!finalContent.trim()) throw new Error('The assistant returned an empty response — please retry.')
      captureLatency(mode, startedAt, firstTokenAt, finalContent)
    } catch (e) {
      if (abortRef.current !== ctrl || (ctrl.signal.aborted && !stalled)) return
      failure = stalled ? 'The assistant timed out — please retry.' : e instanceof Error ? e.message : 'Assistant failed'
      setError(failure)
      setTurns((t) => abortRef.current === ctrl && t[t.length - 1]?.role === 'assistant' && !t[t.length - 1].content ? t.slice(0, -1) : t)
    } finally {
      clearTimeout(watchdog)
      if (abortRef.current === ctrl) { setStreaming(false); settings?.onRunning?.(false) }
    }
    if (abortRef.current !== ctrl || (ctrl.signal.aborted && !stalled)) return
    settings?.onResult?.({
      id: crypto.randomUUID(), question: q, mode, answer: finalContent, transcript,
      instructions: instructions ?? '', calibration: settings.instructions, revision: settings.revision,
      firstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
      totalMs: performance.now() - startedAt, status: failure ? 'error' : 'complete', error: failure, hasImage: !!image,
    })
    return failure ? undefined : finalContent
  }, [turns])

  const clear = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setTurns([])
    setError(null)
    setStreaming(false)
    calibrationRef.current?.onRunning?.(false)
  }, [])
  return { turns, streaming, error, ask, clear }
}
