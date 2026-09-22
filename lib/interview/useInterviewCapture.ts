'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { connectWithFallback } from '@/lib/transcription'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import type { TranscriptionProvider } from '@/lib/transcription/types'
import type { InterviewTurn } from './model'

export type CaptureSource = 'mic' | 'system' | 'both'
export type CaptureStatus = 'idle' | 'starting' | 'recording' | 'stopping'
type Job = {
  cancelled: boolean
  nativeStarting: boolean
  acceptFinal: boolean
  providers: Set<TranscriptionProvider>
  pending: Promise<void> | null
  done: Promise<void> | null
}

/** Independent channels preserve candidate/interviewer attribution, not mixed diarization. */
export function useInterviewCapture(onTurn: (turn: InterviewTurn) => void) {
  const { start: startMic, stop: stopMic } = useMicStream()
  const { start: startSystem, stop: stopSystem } = useMicStream()
  const { start: startNative, stop: stopNative } = useNativeCapture()
  const { keyterms } = useKeytermPrefs()
  const [status, setStatus] = useState<CaptureStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [partial, setPartial] = useState({ candidate: '', interviewer: '' })
  const [levels, setLevels] = useState({ candidate: 0, interviewer: 0 })
  const mounted = useRef(true)
  const jobRef = useRef<Job | null>(null)
  const onTurnRef = useRef(onTurn)
  const termsRef = useRef(keyterms)
  useEffect(() => { onTurnRef.current = onTurn }, [onTurn])
  useEffect(() => { termsRef.current = keyterms }, [keyterms])

  const stopSources = useCallback(async () => {
    // Always stop both browser streams, including partially initialized graphs.
    stopMic()
    stopSystem()
    try { await stopNative() } catch { /* Browser resources still close. */ }
  }, [stopMic, stopSystem, stopNative])

  const stop = useCallback(async () => {
    const job = jobRef.current
    if (!job) return
    if (job.done) return job.done
    job.cancelled = true
    if (mounted.current) setStatus('stopping')
    job.done = (async () => {
      stopMic()
      stopSystem()
      if (!job.nativeStarting) { try { await stopNative() } catch { /* Still drain startup. */ } }
      // A permission prompt / provider connection may resolve after Stop. Drain
      // startup before releasing the guard, so a late stream cannot leak or close
      // a subsequent session's devices.
      await job.pending?.catch(() => undefined)
      await stopSources()
      await Promise.allSettled([...job.providers].map((p) => p.disconnect()))
      job.acceptFinal = false
      job.providers.clear()
      if (jobRef.current === job) jobRef.current = null
      if (mounted.current) {
        setStatus('idle')
        setLevels({ candidate: 0, interviewer: 0 })
        setPartial({ candidate: '', interviewer: '' })
      }
    })()
    return job.done
  }, [stopSources, stopMic, stopSystem, stopNative])

  const start = useCallback(async (source: CaptureSource, sessionStartedAt: number) => {
    if (jobRef.current) return false
    const job: Job = { cancelled: false, nativeStarting: false, acceptFinal: true, providers: new Set(), pending: null, done: null }
    jobRef.current = job
    setError(null)
    setStatus('starting')
    // Initiate getDisplayMedia first in the user's gesture. Do not await an AI
    // request before asking for capture permission.
    const sources: Array<'system' | 'mic'> = source === 'both' ? ['system', 'mic'] : [source]
    let failed = false
    job.pending = (async () => {
      const results = await Promise.allSettled(sources.map(async (channel) => {
        const role = channel === 'mic' ? 'candidate' : 'interviewer'
        const pending: ArrayBuffer[] = []
        let provider: TranscriptionProvider | null = null
        const seen = new Set<string>()
        const onPcm = (pcm: ArrayBuffer) => {
          if (job.cancelled) return
          if (provider) provider.sendAudio(pcm)
          else { pending.push(pcm); if (pending.length > 60) pending.shift() }
        }
        let lastMeterAt = 0
        const onLevel = (value: number) => {
          const now = Date.now()
          if (now - lastMeterAt < 150) return
          lastMeterAt = now
          if (mounted.current && !job.cancelled) setLevels((prev) => ({ ...prev, [role]: value }))
        }
        let rate = 0
        if (channel === 'system') {
          job.nativeStarting = true
          try { rate = await startNative(onPcm, onLevel) }
          catch { try { await stopNative() } catch { /* Fall back to browser capture. */ } }
          finally { job.nativeStarting = false }
          if (job.cancelled) return
          if (!rate) rate = await startSystem(onPcm, onLevel, { source: 'system' })
        } else rate = await startMic(onPcm, onLevel, { source: 'mic' })
        if (job.cancelled) return
        const connected = await connectWithFallback({ keyterms: termsRef.current, sampleRate: rate, maxSpeakers: 1 })
        provider = connected.provider
        job.providers.add(provider)
        if (job.cancelled) return
        provider.onPartial((event) => {
          if (mounted.current && !job.cancelled) setPartial((prev) => ({ ...prev, [role]: event.text }))
        })
        provider.onFinal((event) => {
          if (!mounted.current || !job.acceptFinal || !event.text.trim()) return
          const key = `${event.startMs}:${event.endMs}:${event.text}`
          if (seen.has(key)) return
          seen.add(key)
          setPartial((prev) => ({ ...prev, [role]: '' }))
          // Wall-clock receipt time on a shared session clock. Provider clocks
          // restart independently; never compare them across channels.
          onTurnRef.current({
            id: crypto.randomUUID(), role, text: event.text.trim(),
            atMs: Math.max(0, Date.now() - sessionStartedAt),
            source: channel === 'mic' ? 'microphone' : 'system',
          })
        })
        provider.onStatus?.(() => {
          if (job.cancelled || !mounted.current) return
          setError('Audio transcription disconnected. Your captured text is preserved. Restart capture or type the remaining turns.')
          void stop()
        })
        // Register callbacks before flushing early frames.
        for (const chunk of pending) provider.sendAudio(chunk)
        pending.length = 0
      }))
      const rejected = results.find((r) => r.status === 'rejected')
      failed = !!rejected
      if (failed && mounted.current && !job.cancelled) {
        setError('Audio could not start. Check microphone/system-audio permissions and transcription configuration, then retry. Typed answers remain available.')
      }
    })()
    await job.pending
    if (job.cancelled || failed || !mounted.current) { await stop(); return false }
    setStatus('recording')
    return true
  }, [startMic, startSystem, startNative, stopNative, stop])

  useEffect(() => {
    mounted.current = true
    const leave = () => { void stop() }
    window.addEventListener('pagehide', leave)
    return () => {
      mounted.current = false
      window.removeEventListener('pagehide', leave)
      void stop()
    }
  }, [stop])
  return { start, stop, status, error, partial, levels }
}
