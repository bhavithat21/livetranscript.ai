'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  emptyScreenSnapshot, mergeScreenObservation, parseScreenObservation, screenContext,
} from './screenEvidence'

export type RepoTask = 'plan' | 'debug' | 'review' | 'debrief'
export type AgentProgress = {
  role: string; model: string; status: 'running' | 'done' | 'failed'; text?: string; elapsedMs?: number
}
export type RepoAnalysis = {
  id: string
  question: string; questionId?: string; revision: number; task: RepoTask; answer: string
  agents: AgentProgress[]; running: boolean; error: string | null
}

// Reconstruction and raw frames are session-only. A capture is committed only
// after validated extraction; failed captures can be retried without navigating.
export function useScreenRepository(active: boolean, sharing: boolean, grabFrame: () => string | null) {
  const [snapshot, setSnapshot] = useState(emptyScreenSnapshot)
  const [watching, setWatching] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureError, setCaptureError] = useState<string | null>(null)
  const [captureModel, setCaptureModel] = useState('')
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null)
  const [history, setHistory] = useState<RepoAnalysis[]>([])
  const [displayId, setDisplayId] = useState<string | null>(null)
  const captureController = useRef<AbortController | null>(null)
  const analysisController = useRef<AbortController | null>(null)
  const lastAcceptedFrame = useRef<string | null>(null)

  const captureImage = useCallback(async (image: string, force = false) => {
    if (captureController.current || (!force && image === lastAcceptedFrame.current)) return
    if (image.length > 6_000_000) {
      setCaptureError('This image is too large. Crop to the editor or choose a smaller image.')
      return
    }
    const controller = new AbortController()
    captureController.current = controller
    setCapturing(true)
    setCaptureError(null)
    const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch('/api/copilot/repo-screen', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image }), signal: controller.signal,
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Could not read screenshot')
      const observation = parseScreenObservation(result.observation)
      if (controller.signal.aborted) return
      setSnapshot((current) => mergeScreenObservation(current, observation))
      setCaptureModel(typeof result.model === 'string' ? result.model : '')
      lastAcceptedFrame.current = image
    } catch (error) {
      if (captureController.current === controller) {
        setCaptureError(controller.signal.aborted ? 'Capture timed out. Capture this view again.' : error instanceof Error ? error.message : 'Capture failed')
        setWatching(false) // Avoid repeatedly billing failed automatic captures.
      }
    } finally {
      clearTimeout(timeout)
      if (captureController.current === controller) {
        captureController.current = null
        setCapturing(false)
      }
    }
  }, [])

  const capture = useCallback(async (force = true) => {
    const frame = grabFrame()
    if (!frame) { setCaptureError('Share the browser IDE first, then capture its visible code.'); return }
    await captureImage(frame, force)
  }, [grabFrame, captureImage])

  useEffect(() => {
    if (!active || !sharing || !watching) return
    const timer = window.setInterval(() => void capture(false), 8_000)
    return () => clearInterval(timer)
  }, [active, sharing, watching, capture])

  const analyze = useCallback(async (question: string, context: string, transcript: string, task: RepoTask = 'plan', questionId?: string) => {
    if (analysisController.current || !question.trim()) return false
    const controller = new AbortController()
    analysisController.current = controller
    let record: RepoAnalysis = { id: crypto.randomUUID(), question, ...(questionId ? { questionId } : {}), revision: snapshot.revision, task, answer: '', agents: [], running: true, error: null }
    setAnalysis(record)
    const timeout = setTimeout(() => controller.abort(), 120_000)
    let completed = false
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    const cancelReader = () => { void reader?.cancel().catch(() => {}) }
    controller.signal.addEventListener('abort', cancelReader)
    const event = (line: string) => {
      if (analysisController.current !== controller || controller.signal.aborted) return
      if (!line.trim()) return
      const data: unknown = JSON.parse(line)
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid repository analysis event. Retry this question.')
      const item = data as Record<string, unknown>
      if (item.type === 'error') throw new Error(typeof item.error === 'string' ? item.error : typeof item.text === 'string' ? item.text : 'Repository analysis failed')
      if (item.type === 'done') completed = true
      if (item.type === 'delta') {
        if (typeof item.text !== 'string') throw new Error('Invalid repository answer text. Retry this question.')
        record = { ...record, answer: record.answer + item.text }
        setAnalysis(record)
      }
      if (item.type === 'agent') {
        if (typeof item.role !== 'string' || !['running', 'done', 'failed'].includes(String(item.status))
          || (item.text !== undefined && typeof item.text !== 'string')) throw new Error('Invalid specialist response. Retry this question.')
        const progress: AgentProgress = {
          role: item.role, model: typeof item.model === 'string' ? item.model : 'unavailable',
          status: item.status as AgentProgress['status'], text: item.text as string | undefined,
          elapsedMs: typeof item.elapsedMs === 'number' && Number.isFinite(item.elapsedMs) && item.elapsedMs >= 0 ? item.elapsedMs : undefined,
        }
        record = { ...record, agents: [...record.agents.filter((item) => item.role !== progress.role), progress] }
        setAnalysis(record)
      }
    }
    try {
      const response = await fetch('/api/copilot/repo-analyze', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, context: context.slice(0, 115_000), transcript: transcript.slice(-16_000), task }),
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `Analysis unavailable (${response.status})`)
      }
      reader = response.body.getReader()
      controller.signal.throwIfAborted()
      const decoder = new TextDecoder()
      let buffered = ''
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        received += value?.byteLength ?? 0
        if (received > 1_000_000) throw new Error('Repository analysis exceeded its response limit. Narrow the question and retry.')
        buffered += done ? decoder.decode() : decoder.decode(value, { stream: true })
        const lines = buffered.split('\n')
        buffered = lines.pop() ?? ''
        for (const line of lines) {
          event(line)
          if (completed) break
        }
        if (done || completed) break
        if (buffered.length > 128_000) throw new Error('Repository analysis contained an oversized event. Retry this question.')
      }
      if (!completed) event(buffered)
      controller.signal.throwIfAborted()
      if (!completed) throw new Error('Analysis stream ended before completion. Retry this question.')
      if (!record.answer.trim()) throw new Error('Repository analysis returned no answer. Retry this question.')
      return true
    } catch (error) {
      const aborted = controller.signal.aborted
      controller.abort()
      if (analysisController.current === controller) {
        record = { ...record, error: !aborted && error instanceof Error && error.name !== 'AbortError' ? error.message : 'Analysis stopped or timed out.' }
        setAnalysis(record)
      }
      return false
    } finally {
      clearTimeout(timeout)
      controller.signal.removeEventListener('abort', cancelReader)
      if (reader) {
        void reader.cancel().catch(() => {})
        reader.releaseLock()
      }
      if (analysisController.current === controller) {
        analysisController.current = null
        record = { ...record, running: false }
        setAnalysis(record)
        setHistory((current) => [...current, record].slice(-30))
      }
    }
  }, [snapshot.revision])

  const stopAnalysis = useCallback(() => analysisController.current?.abort(), [])
  const reset = useCallback(() => {
    captureController.current?.abort()
    captureController.current = null
    analysisController.current?.abort()
    analysisController.current = null
    lastAcceptedFrame.current = null
    setSnapshot(emptyScreenSnapshot())
    setAnalysis(null)
    setHistory([])
    setDisplayId(null)
    setCaptureError(null)
    setCapturing(false)
    setWatching(false)
    setCaptureModel('')
  }, [])

  useEffect(() => () => {
    captureController.current?.abort()
    analysisController.current?.abort()
  }, [])

  const contextFor = useCallback((question: string) => screenContext(snapshot, question), [snapshot])
  const displayAnalysis = history.find((item) => item.id === displayId) ?? analysis
  const showQuestion = (question: string, questionId?: string) => setDisplayId(history.findLast((item) =>
    questionId ? item.questionId === questionId : item.question === question,
  )?.id ?? null)
  return { snapshot, watching, setWatching, capturing, captureError, captureModel, capture, captureImage, analysis, displayAnalysis, history, displayId, setDisplayId, showQuestion, analyze, stopAnalysis, reset, contextFor }
}
