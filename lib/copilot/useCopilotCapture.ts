'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { connectWithFallback } from '@/lib/transcription'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import type { TranscriptEvent, TranscriptionProvider } from '@/lib/transcription/types'
import { mergeSegments, transcriptText, type Segment } from '@/lib/transcript/store'

export type CopilotCaptureStatus = 'idle' | 'starting' | 'listening' | 'error'

const MAX_BUFFER_CHUNKS = 60
const MAX_BUFFER_BYTES = 512 * 1024
const MAX_SEGMENTS = 600
const MAX_TRANSCRIPT_CHARS = 80_000
const CONNECT_TIMEOUT_MS = 25_000

type CaptureRun = {
  cancelled: boolean
  abort: AbortController
  provider: TranscriptionProvider | null
  nativeAttempted: boolean
  pending: ArrayBuffer[]
  pendingBytes: number
  connectionTimer: ReturnType<typeof setTimeout> | null
}

// Explicitly opt-in audio for the standalone workspace. It never creates a
// meeting, recording or saved session. Finalized context survives Stop in this
// mounted tab; incomplete ASR hypotheses remain in `segments` for live UI use.
export function useCopilotCapture() {
  const { start: startBrowser, stop: stopBrowser } = useMicStream()
  const { start: startNative, stop: stopNative } = useNativeCapture()
  const { keyterms } = useKeytermPrefs()
  const keytermsRef = useRef(keyterms)
  useEffect(() => { keytermsRef.current = keyterms }, [keyterms])
  const [segments, setSegments] = useState<Segment[]>([])
  const segmentsRef = useRef<Segment[]>([])
  const [status, setStatus] = useState<CopilotCaptureStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [engine, setEngine] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const runRef = useRef<CaptureRun | null>(null)
  const mountedRef = useRef(true)
  const generationRef = useRef(0)

  const finish = useCallback((run: CaptureRun, reason: string | null = null) => {
    if (runRef.current !== run) return
    runRef.current = null
    run.cancelled = true
    run.abort.abort()
    if (run.connectionTimer) clearTimeout(run.connectionTimer)
    run.pending.length = 0
    run.pendingBytes = 0
    stopBrowser()
    const generation = generationRef.current
    if (run.nativeAttempted) {
      void stopNative().catch(() => {
        if (!mountedRef.current || runRef.current || generation !== generationRef.current) return
        setError('Native audio did not confirm it stopped. Close the desktop app to end capture.')
        setStatus('error')
      })
    }
    const provider = run.provider
    run.provider = null
    if (provider) void provider.disconnect().catch(() => {})
    if (mountedRef.current) {
      setLevel(0)
      setError(reason)
      setStatus(reason ? 'error' : 'idle')
    }
  }, [stopBrowser, stopNative])

  const stop = useCallback(() => {
    const run = runRef.current
    if (run) finish(run)
  }, [finish])

  useEffect(() => {
    mountedRef.current = true
    const onPageHide = () => stop()
    window.addEventListener('pagehide', onPageHide)
    return () => {
      mountedRef.current = false
      window.removeEventListener('pagehide', onPageHide)
      stop()
    }
  }, [stop])

  const start = useCallback(async (source: AudioSource) => {
    if (!mountedRef.current || runRef.current) return
    const run: CaptureRun = {
      cancelled: false,
      abort: new AbortController(),
      provider: null,
      nativeAttempted: false,
      pending: [],
      pendingBytes: 0,
      connectionTimer: null,
    }
    runRef.current = run
    generationRef.current += 1
    setError(null)
    setEngine(null)
    setLevel(0)
    setStatus('starting')
    // A new stream must not overwrite the prior stream's trailing hypothesis.
    const finals = segmentsRef.current.filter((segment) => segment.isFinal)
    segmentsRef.current = finals
    setSegments(finals)
    const current = () => mountedRef.current && runRef.current === run && !run.cancelled
    const fail = (cause: unknown) => {
      if (!current()) return
      finish(run, cause instanceof Error ? cause.message : 'Audio capture failed. Please try again.')
    }
    const onPcm = (pcm: ArrayBuffer) => {
      if (!current()) return
      if (run.provider) {
        try { run.provider.sendAudio(pcm) } catch (cause) { fail(cause) }
        return
      }
      if (!pcm.byteLength || pcm.byteLength > MAX_BUFFER_BYTES) return
      run.pending.push(pcm)
      run.pendingBytes += pcm.byteLength
      while (run.pending.length > MAX_BUFFER_CHUNKS || run.pendingBytes > MAX_BUFFER_BYTES) {
        run.pendingBytes -= run.pending.shift()!.byteLength
      }
    }
    let lastLevelAt = -Infinity
    const onLevel = (rms: number) => {
      if (!current() || performance.now() - lastLevelAt < 80) return
      lastLevelAt = performance.now()
      setLevel(Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0)
    }
    const onEnded = () => { if (current()) finish(run) }
    const onTranscript = (event: TranscriptEvent) => {
      if (!current() || !event.text.trim()) return
      let next = mergeSegments(segmentsRef.current, { ...event, text: event.text.slice(0, 10_000) })
      let total = next.reduce((count, segment) => count + segment.text.length, 0)
      let first = 0
      while (next.length - first > MAX_SEGMENTS || (total > MAX_TRANSCRIPT_CHARS && first < next.length - 1)) {
        total -= next[first++].text.length
      }
      if (first) {
        next = next.slice(first)
        setTruncated(true)
      }
      segmentsRef.current = next
      setSegments(next)
    }

    try {
      let sampleRate = 0
      if (source === 'system') {
        run.nativeAttempted = true
        try {
          sampleRate = await startNative(onPcm, onLevel, { source, onEnded })
        } catch {
          if (!current()) return
          // A denied/unsupported native tap can still use the browser picker.
          await stopNative()
        }
        if (!current()) return
      }
      if (!sampleRate) sampleRate = await startBrowser(onPcm, onLevel, { source, onEnded })
      if (!current()) return
      run.connectionTimer = setTimeout(() => {
        if (current()) finish(run, 'Transcription could not connect in time. Check your connection and try again.')
      }, CONNECT_TIMEOUT_MS)
      const connected = await connectWithFallback({
        sampleRate,
        maxSpeakers: source === 'mic' ? 1 : 5,
        keyterms: keytermsRef.current,
        signal: run.abort.signal,
      })
      if (!current()) {
        void connected.provider.disconnect().catch(() => {})
        return
      }
      if (run.connectionTimer) clearTimeout(run.connectionTimer)
      run.connectionTimer = null
      run.provider = connected.provider
      connected.provider.onPartial(onTranscript)
      connected.provider.onFinal(onTranscript)
      connected.provider.onStatus?.(({ error: message }) => {
        if (current()) finish(run, message || 'Transcription connection lost. Start listening to reconnect.')
      })
      for (const pcm of run.pending) {
        if (!current()) break
        connected.provider.sendAudio(pcm)
      }
      run.pending.length = 0
      run.pendingBytes = 0
      if (current()) {
        setEngine(connected.name)
        setStatus('listening')
      }
    } catch (cause) {
      fail(cause)
    }
  }, [startBrowser, startNative, stopNative, finish])

  const getTranscript = useCallback(() => transcriptText(segmentsRef.current), [])
  const clear = useCallback(() => {
    if (runRef.current) return
    segmentsRef.current = []
    setSegments([])
    setTruncated(false)
    setError(null)
    setStatus('idle')
  }, [])

  return { segments, transcript: transcriptText(segments), getTranscript, status, error, engine, level, truncated, start, stop, clear }
}
