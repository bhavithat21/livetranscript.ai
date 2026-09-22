'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { connectWithFallback } from '@/lib/transcription'
import type { TranscriptEvent, TranscriptionProvider } from '@/lib/transcription/types'
import { mergeSegments, type Segment } from '@/lib/transcript/store'

export type CapturedSegment = Segment & { capturedAt: number }
export type CapturePhase = 'idle' | 'starting' | 'recording' | 'stopping'

/** Independent ASR channel, reusing the existing native/browser capture stack.
 * Buffered startup, stop-time finals, generation guards, and unmount cleanup are
 * owned here so a delayed connection cannot reopen an ended interview. */
export function useInterviewRecorder() {
  const { start: startBrowser, stop: stopBrowser } = useMicStream()
  const { start: startNative, stop: stopNative } = useNativeCapture()
  const [phase, setPhase] = useState<CapturePhase>('idle')
  const [segments, setSegments] = useState<CapturedSegment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const provider = useRef<TranscriptionProvider | null>(null)
  const rows = useRef<CapturedSegment[]>([])
  const nativeOwned = useRef(false)
  const mounted = useRef(true)
  const generation = useRef(0)
  const cancelled = useRef(false)
  const running = useRef(false)
  const startup = useRef<Promise<void> | null>(null)
  const shutdown = useRef<Promise<CapturedSegment[]> | null>(null)

  const release = useCallback(async () => {
    stopBrowser()
    if (nativeOwned.current) {
      nativeOwned.current = false
      await stopNative().catch(() => undefined)
    }
    const current = provider.current
    provider.current = null
    if (current) {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          current.disconnect(),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, 2500) }),
        ])
      } catch {
        if (mounted.current) setError('The audio connection ended unexpectedly. Verify the final transcript lines.')
      } finally { clearTimeout(timer) }
    }
  }, [stopBrowser, stopNative])

  const stop = useCallback((): Promise<CapturedSegment[]> => {
    if (shutdown.current) return shutdown.current
    cancelled.current = true
    if (mounted.current) setPhase('stopping')
    const task = (async () => {
      await startup.current?.catch(() => undefined)
      // Keep this generation valid while disconnect flushes final ASR events.
      await release()
      generation.current += 1
      running.current = false
      if (mounted.current) { setPhase('idle'); setLevel(0) }
      return rows.current.slice()
    })()
    shutdown.current = task
    void task.finally(() => { if (shutdown.current === task) shutdown.current = null })
    return task
  }, [release])

  const start = useCallback(async (source: AudioSource, keyterms: string[] = []) => {
    if (running.current || startup.current || shutdown.current) throw new Error('Audio capture is already active or stopping.')
    const token = ++generation.current
    cancelled.current = false
    rows.current = []
    setSegments([])
    setError(null)
    setPhase('starting')
    const valid = () => mounted.current && generation.current === token && !cancelled.current
    const task = (async () => {
      let connected: TranscriptionProvider | null = null
      const pending: ArrayBuffer[] = []
      const onPcm = (pcm: ArrayBuffer) => {
        if (!valid()) return
        if (connected) connected.sendAudio(pcm)
        else { pending.push(pcm); if (pending.length > 60) pending.shift() }
      }
      const onLevel = (rms: number) => { if (valid()) setLevel(rms) }
      try {
        let rate = 0
        if (source === 'system') {
          nativeOwned.current = true
          try { rate = await startNative(onPcm, onLevel) }
          catch { await stopNative().catch(() => undefined) }
          if (!rate) nativeOwned.current = false
        }
        if (!valid()) throw new Error('Audio capture cancelled.')
        if (!rate) rate = await startBrowser(onPcm, onLevel, { source })
        if (!valid()) throw new Error('Audio capture cancelled.')
        const result = await connectWithFallback({ keyterms, sampleRate: rate, maxSpeakers: source === 'mic' ? 1 : 5 })
        provider.current = result.provider
        if (!valid()) throw new Error('Audio capture cancelled.')
        connected = result.provider
        const ingest = (event: TranscriptEvent) => {
          // Stop is allowed to receive the provider's final flush; a newer start
          // or unmount is not. Update the ref synchronously to avoid stale React state.
          if (!mounted.current || generation.current !== token) return
          const previous = new Map(rows.current.map((row) => [row.id, row.capturedAt]))
          rows.current = mergeSegments(rows.current, event).map((row) => ({ ...row, capturedAt: previous.get(row.id) ?? Date.now() }))
          setSegments(rows.current)
        }
        connected.onPartial(ingest)
        connected.onFinal(ingest)
        connected.onStatus?.(({ error: message }) => {
          if (!valid()) return
          setError(message)
          void stop()
        })
        for (const chunk of pending) connected.sendAudio(chunk)
        pending.length = 0
        running.current = true
        setPhase('recording')
      } catch (e) {
        await release()
        if (mounted.current && generation.current === token) {
          setError(cancelled.current ? null : e instanceof Error ? e.message : 'Audio capture failed.')
          if (!cancelled.current) setPhase('idle')
          setLevel(0)
        }
        throw e
      }
    })()
    startup.current = task
    try { await task } finally { if (startup.current === task) startup.current = null }
  }, [startNative, stopNative, startBrowser, release, stop])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      cancelled.current = true
      generation.current += 1
      void release()
    }
  }, [release])

  const getSegments = useCallback(() => rows.current.slice(), [])
  return { start, stop, phase, segments, error, level, getSegments }
}

export function captureText(segments: CapturedSegment[]): string {
  return segments.filter((row) => row.text.trim()).map((row) => `${row.text}${row.isFinal ? '' : ' [Unfinalized transcription; verify]'}`).join('\n')
}

export function liveTranscript(call: CapturedSegment[], microphone: CapturedSegment[]): string {
  return [
    ...call.map((row) => ({ ...row, label: `Call${row.speaker == null ? '' : ` / speaker ${row.speaker + 1}`}` })),
    ...microphone.map((row) => ({ ...row, label: 'Candidate microphone' })),
  ].sort((a, b) => a.capturedAt - b.capturedAt)
    .filter((row) => row.text.trim())
    .map((row) => `${row.label}: ${row.text}${row.isFinal ? '' : ' [Unfinalized transcription; verify]'}`).join('\n')
}
