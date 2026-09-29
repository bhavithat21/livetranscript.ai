'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { connectWithFallback, type ProviderChoice } from '@/lib/transcription'
import { registerRecoveryTest } from '@/lib/reliability/mockControls'
import { RecoveringTranscription } from '@/lib/transcription/recovery'
import type { TranscriptEvent, TranscriptionProvider } from '@/lib/transcription/types'
import { mergeSegments, type Segment } from '@/lib/transcript/store'
import { diagnosticSpan } from '@/lib/diagnostics/client'

export type CapturedSegment = Segment & { capturedAt: number }
export type CapturePhase = 'idle' | 'starting' | 'recording' | 'reconnecting' | 'stopping'
type Trace = ReturnType<typeof diagnosticSpan>
type RecordingRun = {
  cancelled: boolean; acceptFinals: boolean; abort: AbortController
  unregisterTest?: () => void; nativeAttempted: boolean; captureReleased: boolean; connected: TranscriptionProvider | null
  stop: Promise<CapturedSegment[]> | null; timeout: ReturnType<typeof setTimeout> | null
  captureTrace: Trace; asrTrace: Trace | null; watchdog: ReturnType<typeof setInterval> | null
}

/** Independent audio channel. ASR recovery replaces only its network connection;
 * diagnostic timers never fabricate speech or restart physical capture. */
export function useInterviewRecorder() {
  const { start: startBrowser, stop: stopBrowser } = useMicStream()
  const { start: startNative, stop: stopNative, isNative } = useNativeCapture()
  const [phase, setPhase] = useState<CapturePhase>('idle')
  const [segments, setSegments] = useState<CapturedSegment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [level, setLevel] = useState(0)
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null)
  const [connectionGeneration, setConnectionGeneration] = useState(0)
  const rows = useRef<CapturedSegment[]>([])
  const runRef = useRef<RecordingRun | null>(null)
  const mounted = useRef(true)
  const releaseCapture = useCallback((run: RecordingRun) => {
    if (run.captureReleased) return
    run.captureReleased = true
    if (run.watchdog) clearInterval(run.watchdog)
    run.watchdog = null
    run.captureTrace.event('stop', { phase: 'stopping' })
    stopBrowser()
    if (run.nativeAttempted) {
      void stopNative().then(() => run.captureTrace.end('success', { phase: 'idle' })).catch(cause => {
        run.captureTrace.failure(cause)
        if (mounted.current && (!runRef.current || runRef.current === run)) setError('Native audio did not confirm it stopped. Close the desktop app to end capture.')
      })
    } else run.captureTrace.end('success', { phase: 'idle' })
  }, [stopBrowser, stopNative])

  const stop = useCallback((): Promise<CapturedSegment[]> => {
    const run = runRef.current
    if (!run) return Promise.resolve(rows.current.slice())
    if (run.stop) return run.stop
    run.cancelled = true
    run.unregisterTest?.()
    if (run.timeout) clearTimeout(run.timeout)
    releaseCapture(run)
    if (!run.connected) run.abort.abort()
    if (mounted.current) setPhase('stopping')
    run.stop = (async () => {
      const provider = run.connected
      if (provider) {
        let timer: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([provider.disconnect(), new Promise<void>((resolve) => { timer = setTimeout(resolve, 2500) })])
        } catch (cause) {
          run.asrTrace?.failure(cause)
          if (mounted.current && runRef.current === run) setError('The audio connection ended unexpectedly. Verify the final transcript lines.')
        } finally { clearTimeout(timer) }
      }
      run.asrTrace?.end('stop')
      run.acceptFinals = false
      run.abort.abort(); run.connected = null
      if (runRef.current === run) { runRef.current = null; if (mounted.current) { setPhase('idle'); setLevel(0) } }
      return rows.current.slice()
    })()
    return run.stop
  }, [releaseCapture])

  const start = useCallback(async (source: AudioSource, keyterms: string[] = [], maxSpeakers = source === 'mic' ? 1 : 5, preserveSegments = false) => {
    if (runRef.current) throw new Error('Audio capture is already active or stopping.')
    if (!mounted.current) return
    const run: RecordingRun = {
      cancelled: false, acceptFinals: true, abort: new AbortController(), nativeAttempted: false, captureReleased: false,
      connected: null, stop: null, timeout: null, watchdog: null, asrTrace: null,
      captureTrace: diagnosticSpan('audio', { channel: source, source: source === 'system' && isNative ? 'native' : 'browser', phase: 'starting' }),
    }
    runRef.current = run; if (!preserveSegments) { rows.current = []; setSegments([]); setRecoveryNotice(null) }; setError(null); setPhase('starting')
    const valid = () => mounted.current && runRef.current === run && !run.cancelled
    const pending: ArrayBuffer[] = []
    let bufferedBytes = 0, frames = 0, bytes = 0, partials = 0, finals = 0, lastFrameAt = 0, speechDetected = false, stallReported = false
    const startedAt = Date.now()
    run.watchdog = setInterval(() => {
      if (!valid()) return
      const age = Date.now() - (lastFrameAt || startedAt)
      run.captureTrace.event('heartbeat', { frames, bytes, hasFrames: frames > 0, sampleAgeMs: age, speechDetected })
      run.asrTrace?.event('heartbeat', { partials, finals, speechDetected })
      if (age >= 30_000 && !stallReported) { run.captureTrace.event('stall', { hasFrames: frames > 0, sampleAgeMs: age }); stallReported = true }
      speechDetected = false
    }, 30_000)
    const onPcm = (pcm: ArrayBuffer) => {
      if (!valid()) return
      if (pcm.byteLength) {
        if (!frames) run.captureTrace.event('first_frame')
        frames++; bytes += pcm.byteLength; lastFrameAt = Date.now(); stallReported = false
      }
      if (run.connected) {
        try { run.connected.sendAudio(pcm) }
        catch (cause) { run.asrTrace?.failure(cause); setError('The audio connection ended unexpectedly.'); void stop() }
      } else if (pcm.byteLength && pcm.byteLength <= 512 * 1024) {
        pending.push(pcm); bufferedBytes += pcm.byteLength
        while (pending.length > 60 || bufferedBytes > 512 * 1024) bufferedBytes -= pending.shift()!.byteLength
      }
    }
    let lastLevelAt = -Infinity
    const onLevel = (rms: number) => {
      if (!valid() || performance.now() - lastLevelAt < 80) return
      if (Number.isFinite(rms) && rms > 0.02) speechDetected = true
      lastLevelAt = performance.now(); setLevel(Number.isFinite(rms) ? Math.max(0, Math.min(1, rms)) : 0)
    }
    const onEnded = (reason?: string) => { if (valid()) { if (reason) { startupError = new Error(reason); setError(reason); run.captureTrace.event('error', { code: 'native_ended' }) } else run.captureTrace.event('stop'); void stop() } }
    let startupError: Error | null = null
    try {
      let rate = 0
      if (source === 'system') {
        run.nativeAttempted = true
        try { rate = await startNative(onPcm, onLevel, { source, onEnded }) }
        catch (cause) {
          if (!valid()) { if (startupError) throw startupError; return }
          await stopNative()
          if (isNative) throw new Error(typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : 'System audio could not start. Check macOS audio recording permission and reopen the app.')
        }
      }
      if (!valid()) { if (startupError) throw startupError; return }
      if (!rate) rate = await startBrowser(onPcm, onLevel, { source, onEnded })
      if (!valid()) return
      run.captureTrace.event('ready')
      run.asrTrace = diagnosticSpan('transcription', { channel: source })
      run.timeout = setTimeout(() => {
        if (!valid()) return
        startupError = new Error('Transcription could not connect in time. Check your connection and try again.')
        run.asrTrace?.end('error', { code: 'timeout' }); setError(startupError.message); void stop()
      }, 25_000)
      const result = await connectWithFallback({ keyterms, sampleRate: rate, maxSpeakers: Math.max(1, Math.min(10, maxSpeakers)), signal: run.abort.signal, diagnosticHeaders: run.asrTrace.headers() })
      if (!valid()) { void result.provider.disconnect().catch(() => {}); if (startupError) throw startupError; return }
      if (run.timeout) clearTimeout(run.timeout)
      run.timeout = null
      const config = { keyterms, sampleRate: rate, maxSpeakers: Math.max(1, Math.min(10, maxSpeakers)), signal: run.abort.signal, diagnosticHeaders: run.asrTrace.headers() }
      const provider = new RecoveringTranscription(result, config,
        (next, preferred) => connectWithFallback(next, undefined, (['Deepgram', 'AssemblyAI'].includes(preferred) ? preferred : 'auto') as ProviderChoice),
        event => {
          if (!valid()) return
          if (event.state === 'reconnecting') { setPhase('reconnecting'); run.asrTrace?.event('retry', { attempts: event.attempt }) }
          if (event.state === 'reconnected') { setPhase('recording'); setConnectionGeneration(value => value + 1); partials = 0; finals = 0; run.asrTrace?.event('ready', { attempts: event.attempt }) }
          if (event.state === 'gap') { setRecoveryNotice('The transcription connection was interrupted. Some audio may be missing; verify the transcript and interviewer voice.'); run.asrTrace?.event('gap', { droppedMs: event.droppedMs }) }
        })
      run.connected = provider
      run.unregisterTest = registerRecoveryTest(run.asrTrace.id, () => valid() && provider.testConnectionLoss())
      setConnectionGeneration(value => value + 1)
      run.asrTrace.event('ready')
      const ingest = (event: TranscriptEvent) => {
        if (!mounted.current || runRef.current !== run || !run.acceptFinals) return
        const previous = new Map(rows.current.map((row) => [row.id, row.capturedAt]))
        const utteranceTime = event.utteranceId ? rows.current.find(row => row.utteranceId === event.utteranceId)?.capturedAt : undefined
        rows.current = mergeSegments(rows.current, event).map((row) => ({ ...row, capturedAt: previous.get(row.id) ?? utteranceTime ?? Date.now() }))
        setSegments(rows.current)
      }
      provider.onPartial(event => { if (mounted.current && runRef.current === run && run.acceptFinals) { if (!partials++) run.asrTrace?.event('first_partial') }; ingest(event) })
      provider.onFinal(event => { if (mounted.current && runRef.current === run && run.acceptFinals) { if (!finals++) run.asrTrace?.event('first_final') }; ingest(event) })
      provider.onStatus?.(({ error: message }) => { if (!valid()) return; run.asrTrace?.failure(message); setError(message); void stop() })
      for (const chunk of pending) { if (!valid()) break; provider.sendAudio(chunk) }
      pending.length = 0
      if (valid()) setPhase(provider.isRecovering ? 'reconnecting' : 'recording')
    } catch (cause) {
      if (!valid()) { if (startupError) throw startupError; return }
      if (run.asrTrace) run.asrTrace.failure(cause); else run.captureTrace.failure(cause)
      setError(cause instanceof Error ? cause.message : 'Audio capture failed.'); await stop(); throw cause
    }
  }, [startNative, stopNative, startBrowser, stop, isNative])

  useEffect(() => {
    mounted.current = true
    const onPageHide = () => { void stop() }
    window.addEventListener('pagehide', onPageHide)
    return () => { mounted.current = false; window.removeEventListener('pagehide', onPageHide); void stop() }
  }, [stop])
  const getSegments = useCallback(() => rows.current.slice(), [])
  return { start, stop, phase, segments, error, level, recoveryNotice, connectionGeneration, getSegments }
}
export function captureText(segments: CapturedSegment[]): string {
  return segments.filter((row) => row.text.trim()).map((row) => `${row.text}${row.isFinal ? '' : ' [Unfinalized transcription; verify]'}`).join('\n')
}
export function liveTranscript(call: CapturedSegment[], microphone: CapturedSegment[]): string {
  return [...call.map((row) => ({ ...row, label: `Call${row.speaker == null ? '' : ` / speaker ${row.speaker + 1}`}` })), ...microphone.map((row) => ({ ...row, label: 'Candidate microphone' }))]
    .sort((a, b) => a.capturedAt - b.capturedAt).filter((row) => row.text.trim())
    .map((row) => `${row.label}: ${row.text}${row.isFinal ? '' : ' [Unfinalized transcription; verify]'}`).join('\n')
}
