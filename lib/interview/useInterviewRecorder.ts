'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { connectWithFallback } from '@/lib/transcription'
import type { TranscriptEvent, TranscriptionProvider } from '@/lib/transcription/types'
import { mergeSegments, type Segment } from '@/lib/transcript/store'

export type CapturedSegment = Segment & { capturedAt: number }
export type CapturePhase = 'idle' | 'starting' | 'recording' | 'stopping'

type RecordingRun = {
  cancelled: boolean
  acceptFinals: boolean
  abort: AbortController
  nativeAttempted: boolean
  captureReleased: boolean
  connected: TranscriptionProvider | null
  stop: Promise<CapturedSegment[]> | null
  timeout: ReturnType<typeof setTimeout> | null
}

/** Independent ASR channel. Cancelling startup does not wait for a browser
 * permission dialog. Normal Stop still accepts the established ASR stream's
 * trailing final before returning the transcript for feedback. */
export function useInterviewRecorder() {
  const { start: startBrowser, stop: stopBrowser } = useMicStream()
  const { start: startNative, stop: stopNative } = useNativeCapture()
  const [phase, setPhase] = useState<CapturePhase>('idle')
  const [segments, setSegments] = useState<CapturedSegment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const rows = useRef<CapturedSegment[]>([])
  const runRef = useRef<RecordingRun | null>(null)
  const mounted = useRef(true)

  const releaseCapture = useCallback((run: RecordingRun) => {
    if (run.captureReleased) return
    run.captureReleased = true
    stopBrowser()
    if (run.nativeAttempted) {
      void stopNative().catch(() => {
        if (mounted.current && (!runRef.current || runRef.current === run)) {
          setError('Native audio did not confirm it stopped. Close the desktop app to end capture.')
        }
      })
    }
  }, [stopBrowser, stopNative])

  const stop = useCallback((): Promise<CapturedSegment[]> => {
    const run = runRef.current
    if (!run) return Promise.resolve(rows.current.slice())
    if (run.stop) return run.stop
    run.cancelled = true
    if (run.timeout) clearTimeout(run.timeout)
    releaseCapture(run)
    // Startup has no final transcript to flush; abort token fetch / websocket
    // now. The pending capture bridges retire any late permission grant.
    if (!run.connected) run.abort.abort()
    if (mounted.current) setPhase('stopping')
    run.stop = (async () => {
      const provider = run.connected
      if (provider) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            provider.disconnect(),
            new Promise<void>((resolve) => { timer = setTimeout(resolve, 2500) }),
          ])
        } catch {
          if (mounted.current && runRef.current === run) setError('The audio connection ended unexpectedly. Verify the final transcript lines.')
        } finally { clearTimeout(timer) }
      }
      run.acceptFinals = false
      run.abort.abort()
      run.connected = null
      if (runRef.current === run) {
        runRef.current = null
        if (mounted.current) { setPhase('idle'); setLevel(0) }
      }
      return rows.current.slice()
    })()
    return run.stop
  }, [releaseCapture])

  const start = useCallback(async (source: AudioSource, keyterms: string[] = []) => {
    if (runRef.current) throw new Error('Audio capture is already active or stopping.')
    if (!mounted.current) return
    const run: RecordingRun = {
      cancelled: false, acceptFinals: true, abort: new AbortController(),
      nativeAttempted: false, captureReleased: false, connected: null, stop: null, timeout: null,
    }
    runRef.current = run
    rows.current = []
    setSegments([])
    setError(null)
    setPhase('starting')
    const valid = () => mounted.current && runRef.current === run && !run.cancelled
    const pending: ArrayBuffer[] = []
    let bufferedBytes = 0
    const onPcm = (pcm: ArrayBuffer) => {
      if (!valid()) return
      if (run.connected) {
        try { run.connected.sendAudio(pcm) }
        catch { setError('The audio connection ended unexpectedly.'); void stop() }
      } else if (pcm.byteLength && pcm.byteLength <= 512 * 1024) {
        pending.push(pcm)
        bufferedBytes += pcm.byteLength
        while (pending.length > 60 || bufferedBytes > 512 * 1024) bufferedBytes -= pending.shift()!.byteLength
      }
    }
    let lastLevelAt = -Infinity
    const onLevel = (rms: number) => {
      if (!valid() || performance.now() - lastLevelAt < 80) return
      lastLevelAt = performance.now()
      setLevel(Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0)
    }
    const onEnded = () => { if (valid()) void stop() }
    try {
      let rate = 0
      if (source === 'system') {
        run.nativeAttempted = true
        try { rate = await startNative(onPcm, onLevel, { source, onEnded }) }
        catch {
          if (!valid()) return
          await stopNative()
        }
      }
      if (!valid()) return
      if (!rate) rate = await startBrowser(onPcm, onLevel, { source, onEnded })
      if (!valid()) return
      run.timeout = setTimeout(() => {
        if (!valid()) return
        setError('Transcription could not connect in time. Check your connection and try again.')
        void stop()
      }, 25_000)
      const result = await connectWithFallback({ keyterms, sampleRate: rate, maxSpeakers: source === 'mic' ? 1 : 5, signal: run.abort.signal })
      if (!valid()) {
        void result.provider.disconnect().catch(() => {})
        return
      }
      if (run.timeout) clearTimeout(run.timeout)
      run.timeout = null
      run.connected = result.provider
      const ingest = (event: TranscriptEvent) => {
        // Established Stop may flush a final; a replaced/unmounted run may not.
        if (!mounted.current || runRef.current !== run || !run.acceptFinals) return
        const previous = new Map(rows.current.map((row) => [row.id, row.capturedAt]))
        rows.current = mergeSegments(rows.current, event).map((row) => ({ ...row, capturedAt: previous.get(row.id) ?? Date.now() }))
        setSegments(rows.current)
      }
      result.provider.onPartial(ingest)
      result.provider.onFinal(ingest)
      result.provider.onStatus?.(({ error: message }) => {
        if (!valid()) return
        setError(message)
        void stop()
      })
      for (const chunk of pending) {
        if (!valid()) break
        result.provider.sendAudio(chunk)
      }
      pending.length = 0
      if (valid()) setPhase('recording')
    } catch (cause) {
      if (!valid()) return
      setError(cause instanceof Error ? cause.message : 'Audio capture failed.')
      await stop()
      throw cause
    }
  }, [startNative, stopNative, startBrowser, stop])

  useEffect(() => {
    mounted.current = true
    const onPageHide = () => { void stop() }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      mounted.current = false
      window.removeEventListener('pagehide', onPageHide)
      void stop()
    }
  }, [stop])

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
