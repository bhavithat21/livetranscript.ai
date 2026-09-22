'use client'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { captureLatency } from './latency'
import { CopilotCalibrationContext } from '@/lib/interview/TuningContext'
import type { AnswerPreferences } from './answerPreferences'

export type CopilotTurn = { role: 'user' | 'assistant'; content: string; mode: string; requestId?: number }
const STALL_TIMEOUT_MS = 20_000
const TOKEN_GAP_MS = 15_000

// One transport for Live and Mock. Snapshot calibration and preferences per request.
// Every stream owns its turn; stale chunks cannot append to a later question.
export function useCopilot(getTranscript: () => string, preferences?: AnswerPreferences) {
  const [turns, setTurns] = useState<CopilotTurn[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const turnsRef = useRef<CopilotTurn[]>([])
  const abortRef = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const mounted = useRef(true)
  const transcriptRef = useRef(getTranscript)
  transcriptRef.current = getTranscript
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  const calibration = useContext(CopilotCalibrationContext)
  const calibrationRef = useRef(calibration)
  calibrationRef.current = calibration
  const runningCallback = useRef<((running: boolean) => void) | undefined>(undefined)

  const updateTurns = useCallback((update: (current: CopilotTurn[]) => CopilotTurn[]) => {
    turnsRef.current = update(turnsRef.current)
    setTurns(turnsRef.current)
  }, [])
  const cancel = useCallback(() => {
    const controller = abortRef.current
    abortRef.current = null
    controller?.abort()
    runningCallback.current?.(false)
    runningCallback.current = undefined
  }, [])
  const stop = useCallback(() => {
    cancel()
    setStreaming(false)
    updateTurns((current) => current.filter((turn) => turn.role !== 'assistant' || !!turn.content))
  }, [cancel, updateTurns])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; cancel() }
  }, [cancel])

  const ask = useCallback(async (
    question: string, mode: string = 'general', image?: string | null,
    context?: string | null, instructions?: string | null,
  ): Promise<string | undefined> => {
    const q = question.trim()
    if (!q || !mounted.current) return
    cancel()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const requestId = ++sequence.current
    const current = () => mounted.current && abortRef.current === ctrl
    const settings = calibrationRef.current
    const transcript = transcriptRef.current()
    const selectedPreferences = preferencesRef.current ? { ...preferencesRef.current } : undefined
    const history = turnsRef.current.filter((turn) => turn.mode === mode && !!turn.content).slice(-8)
      .map(({ role, content }) => ({ role, content }))
    setError(null)
    updateTurns((previous) => [...previous.filter((turn) => turn.role !== 'assistant' || !!turn.content),
      { role: 'user', content: q, mode, requestId }, { role: 'assistant', content: '', mode, requestId }])
    setStreaming(true)
    runningCallback.current = settings?.onRunning
    settings?.onRunning?.(true)

    let stalled = false
    let watchdog: ReturnType<typeof setTimeout> | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    const cancelReader = () => { clearTimeout(watchdog); void reader?.cancel().catch(() => {}) }
    ctrl.signal.addEventListener('abort', cancelReader)
    const arm = (ms: number) => {
      clearTimeout(watchdog)
      watchdog = setTimeout(() => { stalled = true; ctrl.abort() }, ms)
    }
    arm(STALL_TIMEOUT_MS)
    let finalContent = ''
    let failure: string | undefined
    const startedAt = performance.now()
    let firstTokenAt: number | null = null
    const append = (text: string) => {
      if (!text || !current() || ctrl.signal.aborted) return
      if (firstTokenAt === null) firstTokenAt = performance.now()
      finalContent += text
      arm(TOKEN_GAP_MS)
      updateTurns((previous) => previous.map((turn) => turn.role === 'assistant' && turn.requestId === requestId
        ? { ...turn, content: finalContent } : turn))
    }
    try {
      const res = await fetch('/api/copilot/answer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, transcript, history, mode, image: image ?? undefined,
          context: context ?? undefined, instructions: instructions ?? undefined,
          calibration: settings?.instructions || undefined, preferences: selectedPreferences }),
        signal: ctrl.signal,
      })
      if (!current() || ctrl.signal.aborted) { void res.body?.cancel().catch(() => {}); ctrl.signal.throwIfAborted(); return }
      if (!res.ok || !res.body) throw new Error(res.status === 401 ? 'Sign in to use the assistant' : 'Assistant unavailable. Please retry.')
      reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        ctrl.signal.throwIfAborted()
        if (!current()) return
        if (done) { append(decoder.decode()); break }
        append(decoder.decode(value, { stream: true }))
      }
      if (!finalContent.trim()) throw new Error('The assistant returned an empty response — please retry.')
      captureLatency(mode, startedAt, firstTokenAt, finalContent)
    } catch (cause) {
      if (!current() || (ctrl.signal.aborted && !stalled)) return
      failure = stalled ? 'The assistant timed out — please retry.' : cause instanceof Error ? cause.message : 'Assistant failed. Please retry.'
      setError(failure)
      updateTurns((previous) => previous.filter((turn) => turn.requestId !== requestId || turn.role !== 'assistant' || !!turn.content))
    } finally {
      clearTimeout(watchdog)
      ctrl.signal.removeEventListener('abort', cancelReader)
      void reader?.cancel().catch(() => {})
      reader?.releaseLock()
      if (current()) {
        setStreaming(false)
        runningCallback.current = undefined
        settings?.onRunning?.(false)
      }
    }
    if (!current() || (ctrl.signal.aborted && !stalled)) return
    abortRef.current = null
    settings?.onResult?.({
      id: crypto.randomUUID(), question: q, mode, answer: finalContent, transcript,
      instructions: instructions ?? '', calibration: settings.instructions, revision: settings.revision,
      firstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
      totalMs: performance.now() - startedAt, status: failure ? 'error' : 'complete', error: failure, hasImage: !!image,
    })
    // Keep a partial response visible, but never return it as a complete answer to
    // the code executor or record it as a successful Mock observation.
    return failure ? undefined : finalContent
  }, [cancel, updateTurns])

  const clear = useCallback(() => {
    stop()
    updateTurns(() => [])
    setError(null)
  }, [stop, updateTurns])
  return { turns, streaming, error, ask, clear, stop }
}
