'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { captureLatency } from './latency'
import type { AnswerPreferences } from './answerPreferences'

export type AnswerEntry = {
  id: number; question: string; answer: string; streaming: boolean; retrying: boolean; failed: boolean
  error?: string | null
}
type RequestArgs = { mode: string; meContext: string | null; image: string | null; instructions?: string | null; transcript?: string | null; preferences?: AnswerPreferences }
const STALL_TIMEOUT_MS = 20_000
const TOKEN_GAP_MS = 15_000
const MAX_AUTO_RETRIES = 2
const RETRY_BACKOFF_MS = [800, 2500]
const HISTORY_TURNS = 6

function backoff(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(false); return }
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(false) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(true) }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

// Each card has one active run. Retry replaces that run; clear and unmount cancel
// both in-flight streams and scheduled retries so old questions cannot reappear.
export function useAnswerFeed(preferences?: AnswerPreferences) {
  const [entries, setEntries] = useState<AnswerEntry[]>([])
  const [cursor, setCursor] = useState(0)
  const idRef = useRef(0)
  const argsRef = useRef(new Map<number, RequestArgs>())
  const entriesRef = useRef<AnswerEntry[]>([])
  const jobs = useRef(new Map<number, AbortController>())
  const mounted = useRef(true)
  const preferencesRef = useRef(preferences)
  useEffect(() => { preferencesRef.current = preferences }, [preferences])
  const updateEntries = useCallback((update: (current: AnswerEntry[]) => AnswerEntry[]) => {
    entriesRef.current = update(entriesRef.current)
    setEntries(entriesRef.current)
  }, [])
  const cancelAll = useCallback(() => {
    for (const controller of jobs.current.values()) controller.abort()
    jobs.current.clear()
  }, [])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; cancelAll() }
  }, [cancelAll])

  const run = useCallback(async (id: number, question: string, args: RequestArgs) => {
    jobs.current.get(id)?.abort()
    const job = new AbortController()
    jobs.current.set(id, job)
    const current = () => mounted.current && jobs.current.get(id) === job && !job.signal.aborted
    const update = (changes: Partial<AnswerEntry>) => {
      if (current()) updateEntries((previous) => previous.map((entry) => entry.id === id ? { ...entry, ...changes } : entry))
    }
    let failureMessage = 'Assistant unavailable. Please retry.'
    let retryable = true
    try {
      for (let attempt = 0; attempt <= MAX_AUTO_RETRIES; attempt++) {
        if (!current()) return
        if (attempt > 0) {
          update({ retrying: true, streaming: true })
          if (!await backoff(RETRY_BACKOFF_MS[attempt - 1], job.signal) || !current()) return
        }
        const controller = new AbortController()
        const cancelAttempt = () => controller.abort()
        job.signal.addEventListener('abort', cancelAttempt, { once: true })
        let watchdog: ReturnType<typeof setTimeout> | undefined
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
        let stalled = false
        const cancelReader = () => { clearTimeout(watchdog); void reader?.cancel().catch(() => {}) }
        controller.signal.addEventListener('abort', cancelReader)
        const arm = (ms: number) => {
          clearTimeout(watchdog)
          watchdog = setTimeout(() => { stalled = true; controller.abort() }, ms)
        }
        arm(STALL_TIMEOUT_MS)
        let raw = ''
        const startedAt = performance.now()
        let firstTokenAt: number | null = null
        update({ answer: '', streaming: true, retrying: attempt > 0, failed: false, error: null })
        try {
          const history = entriesRef.current.filter((entry) => entry.id < id && !entry.streaming && !entry.failed && !!entry.answer.trim()
            && argsRef.current.get(entry.id)?.mode === args.mode)
            .slice(-HISTORY_TURNS).flatMap((entry) => [
              { role: 'user' as const, content: entry.question }, { role: 'assistant' as const, content: entry.answer },
            ])
          const response = await fetch('/api/copilot/answer', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, transcript: args.transcript ?? '', mode: args.mode, history,
              image: args.image ?? undefined, context: args.meContext ?? undefined, instructions: args.instructions ?? undefined,
              preferences: args.preferences }),
            signal: controller.signal,
          })
          if (!current() || controller.signal.aborted) { void response.body?.cancel().catch(() => {}); controller.signal.throwIfAborted(); return }
          if (!response.ok || !response.body) {
            retryable = ![400, 401, 403, 413].includes(response.status)
            throw new Error(response.status === 401 ? 'Sign in to use the assistant' : 'Assistant unavailable. Please retry.')
          }
          reader = response.body.getReader()
          const decoder = new TextDecoder()
          for (;;) {
            const { done, value } = await reader.read()
            controller.signal.throwIfAborted()
            if (!current()) return
            const text = done ? decoder.decode() : decoder.decode(value, { stream: true })
            if (text) {
              if (firstTokenAt === null) firstTokenAt = performance.now()
              raw += text
              arm(TOKEN_GAP_MS)
              update({ answer: raw, retrying: false })
            }
            if (done) break
          }
          if (!raw.trim()) throw new Error('The assistant returned no answer. Please retry.')
          captureLatency(args.mode, startedAt, firstTokenAt, raw)
          update({ streaming: false, retrying: false, failed: false, error: null })
          return
        } catch (failure) {
          if (!current()) return
          failureMessage = stalled ? 'The assistant timed out. Please retry.' : failure instanceof Error ? failure.message : 'Assistant failed. Please retry.'
        } finally {
          clearTimeout(watchdog)
          job.signal.removeEventListener('abort', cancelAttempt)
          controller.signal.removeEventListener('abort', cancelReader)
          void reader?.cancel().catch(() => {})
          reader?.releaseLock()
        }
        if (!retryable) break
      }
      update({ streaming: false, retrying: false, failed: true, error: failureMessage })
    } finally {
      if (jobs.current.get(id) === job) jobs.current.delete(id)
    }
  }, [updateEntries])

  const answer = useCallback(async (
    question: string, mode: string, meContext: string | null, image: string | null,
    instructions?: string | null, transcript?: string | null,
  ) => {
    if (!question.trim() || !mounted.current) return
    const id = ++idRef.current
    const args: RequestArgs = { mode, meContext, image, instructions, transcript,
      preferences: preferencesRef.current ? { ...preferencesRef.current } : undefined }
    argsRef.current.set(id, args)
    const previousLength = entriesRef.current.length
    updateEntries((previous) => [...previous, { id, question, answer: '', streaming: true, retrying: false, failed: false, error: null }])
    setCursor((current) => current >= previousLength - 1 ? previousLength : current)
    await run(id, question, args)
  }, [run, updateEntries])

  const retry = useCallback((id: number) => {
    const entry = entriesRef.current.find((item) => item.id === id)
    const args = argsRef.current.get(id)
    if (entry && args && mounted.current) void run(id, entry.question, args)
  }, [run])
  const stop = useCallback(() => {
    cancelAll()
    updateEntries((previous) => previous.map((entry) => entry.streaming
      ? { ...entry, streaming: false, retrying: false, failed: true, error: 'Answer stopped. Retry to finish.' } : entry))
  }, [cancelAll, updateEntries])
  const clear = useCallback(() => {
    cancelAll()
    updateEntries(() => [])
    setCursor(0)
    argsRef.current.clear()
  }, [cancelAll, updateEntries])
  const prev = useCallback(() => setCursor((current) => Math.max(0, current - 1)), [])
  const next = useCallback(() => setCursor((current) => Math.max(0, Math.min(entriesRef.current.length - 1, current + 1))), [])
  const questions = useCallback(() => entriesRef.current.map((entry) => ({ q: entry.question, mode: argsRef.current.get(entry.id)?.mode ?? 'general' })), [])
  const current = entries[Math.min(cursor, entries.length - 1)] ?? null
  return { entries, current, cursor, count: entries.length, answer, retry, clear, stop, prev, next, questions }
}
