'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { floatTo16BitPCM } from './pcm'

const TARGET_SAMPLE_RATE = 16000

// 'system' uses the browser's explicit audio-sharing picker.
export type AudioSource = 'mic' | 'system'

export interface MicStreamOptions {
  source?: AudioSource
  isMuted?: () => boolean
  // The browser/user ended an audio track (not our own stop()).
  onEnded?: () => void
}

type CaptureSession = {
  cancelled: boolean
  stream: MediaStream | null
  context: AudioContext | null
  source: MediaStreamAudioSourceNode | null
  processor: AudioWorkletNode | null
  sink: GainNode | null
  removeListeners: (() => void)[]
}

function release(session: CaptureSession) {
  session.removeListeners.splice(0).forEach((remove) => remove())
  if (session.processor) {
    session.processor.port.onmessage = null
    session.processor.port.close()
    session.processor.disconnect()
    session.processor = null
  }
  session.source?.disconnect()
  session.source = null
  session.sink?.disconnect()
  session.sink = null
  session.stream?.getTracks().forEach((track) => track.stop())
  session.stream = null
  const context = session.context
  session.context = null
  if (context && context.state !== 'closed') void context.close().catch(() => {})
}

function assertActive(session: CaptureSession) {
  if (session.cancelled) throw new DOMException('Audio capture cancelled', 'AbortError')
}

// A session owns its resources even while a permission dialog or worklet load
// is pending. Stopping invalidates that session immediately; a late grant closes
// its own tracks instead of leaking them or replacing a newer capture.
export function useMicStream() {
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<CaptureSession | null>(null)

  const stop = useCallback(() => {
    const session = sessionRef.current
    sessionRef.current = null
    if (!session) return
    session.cancelled = true
    release(session)
  }, [])

  useEffect(() => stop, [stop])

  const start = useCallback(
    async (
      onPcm: (pcm: ArrayBuffer) => void,
      onLevel: (rms: number) => void,
      opts: MicStreamOptions = {},
    ): Promise<number> => {
      stop()
      setError(null)
      const session: CaptureSession = {
        cancelled: false, stream: null, context: null, source: null,
        processor: null, sink: null, removeListeners: [],
      }
      sessionRef.current = session
      try {
        if (opts.source === 'system') {
          if (!navigator.mediaDevices?.getDisplayMedia) {
            throw new Error('System audio sharing is not available in this browser. Use a supported desktop browser or the desktop app.')
          }
          const display = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: true,
            systemAudio: 'include',
            surfaceSwitching: 'include',
            monitorTypeSurfaces: 'exclude',
          } as MediaStreamConstraints)
          session.stream = display
          assertActive(session)
          display.getVideoTracks().forEach((track) => track.stop())
          if (display.getAudioTracks().length === 0) {
            throw new Error('No system audio shared — pick a tab/window and enable “Share audio”.')
          }
        } else {
          if (!navigator.mediaDevices?.getUserMedia) {
            throw new Error('Microphone capture is not available in this browser.')
          }
          session.stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
          assertActive(session)
        }
        const stream = session.stream
        const ended = () => {
          if (session.cancelled) return
          session.cancelled = true
          release(session)
          if (sessionRef.current === session) sessionRef.current = null
          opts.onEnded?.()
        }
        for (const track of stream.getAudioTracks()) {
          track.addEventListener('ended', ended)
          session.removeListeners.push(() => track.removeEventListener('ended', ended))
          if (track.readyState === 'ended') {
            ended()
            assertActive(session)
          }
        }

        let context: AudioContext
        try {
          context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
        } catch {
          context = new AudioContext()
        }
        session.context = context
        await context.audioWorklet.addModule('/worklet-processor.js')
        assertActive(session)
        if (context.state === 'suspended') {
          await context.resume()
          assertActive(session)
        }
        session.source = context.createMediaStreamSource(stream)
        const processor = new AudioWorkletNode(context, 'pcm-processor')
        session.processor = processor
        processor.port.onmessage = (event: MessageEvent<{ samples: Float32Array; rms: number }>) => {
          if (session.cancelled) return
          if (opts.isMuted?.()) {
            onLevel(0)
            return
          }
          const pcm = floatTo16BitPCM(event.data.samples)
          onPcm(pcm.slice().buffer as ArrayBuffer)
          onLevel(event.data.rms)
        }
        session.source.connect(processor)
        // Pull the graph through a muted sink, avoiding microphone feedback.
        const sink = context.createGain()
        session.sink = sink
        sink.gain.value = 0
        processor.connect(sink)
        sink.connect(context.destination)
        return context.sampleRate
      } catch (cause) {
        release(session)
        if (sessionRef.current === session) {
          sessionRef.current = null
          if (!session.cancelled) setError(cause instanceof Error ? cause.message : 'Audio capture failed')
        }
        throw cause
      }
    },
    [stop],
  )

  return { start, stop, error }
}
