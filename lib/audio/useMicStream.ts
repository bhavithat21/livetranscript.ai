import { useRef, useState, useCallback } from 'react'
import { floatTo16BitPCM } from './pcm'

const TARGET_SAMPLE_RATE = 16000

// Where the audio comes from. 'mic' = the user's microphone; 'system' = tab /
// system audio via getDisplayMedia (e.g. a call playing through the speakers).
export type AudioSource = 'mic' | 'system'

export interface MicStreamOptions {
  source?: AudioSource
  // Polled each frame — while it returns true we skip sending PCM (mic "muted")
  // without tearing down the stream, so unmuting is instant.
  isMuted?: () => boolean
}

// Opens an audio source, streams 16-bit PCM to onPcm, reports RMS level to
// onLevel, and returns the ACTUAL sample rate (pass it to the provider).
export function useMicStream() {
  const [error, setError] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(
    async (
      onPcm: (pcm: ArrayBuffer) => void,
      onLevel: (rms: number) => void,
      opts: MicStreamOptions = {},
    ): Promise<number> => {
      setError(null)
      const source = opts.source ?? 'mic'
      try {
        let stream: MediaStream
        if (source === 'system') {
          // System / tab audio. Chrome requires video:true to expose the audio
          // picker; we grab the audio track and drop video. User-gesture required.
          const display = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
          display.getVideoTracks().forEach((t) => t.stop())
          if (display.getAudioTracks().length === 0) {
            display.getTracks().forEach((t) => t.stop())
            throw new Error('No system audio shared — pick a tab/window and enable “Share audio”.')
          }
          stream = new MediaStream(display.getAudioTracks())
        } else {
          // gUM sampleRate is advisory + can perturb echo-cancel DSP; the ctx resamples.
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true },
          })
        }
        streamRef.current = stream

        // Forcing 16k can throw NotSupportedError on some engines — fall back to default.
        let ctx: AudioContext
        try {
          ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
        } catch {
          ctx = new AudioContext()
        }
        ctxRef.current = ctx
        await ctx.audioWorklet.addModule('/worklet-processor.js')
        const src = ctx.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(ctx, 'pcm-processor')
        node.port.onmessage = (ev: MessageEvent<{ samples: Float32Array; rms: number }>) => {
          if (opts.isMuted?.()) {
            onLevel(0)
            return // muted: keep the graph alive but send nothing
          }
          const pcm = floatTo16BitPCM(ev.data.samples)
          onPcm(pcm.slice().buffer as ArrayBuffer)
          onLevel(ev.data.rms)
        }
        src.connect(node)
        // Muted sink, not ctx.destination — routing the mic to the speakers causes
        // echo/feedback. gain=0 still pulls the graph so the processor keeps running.
        const sink = ctx.createGain()
        sink.gain.value = 0
        node.connect(sink)
        sink.connect(ctx.destination)
        return ctx.sampleRate
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Audio capture failed')
        throw e
      }
    },
    [],
  )

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    ctxRef.current?.close()
    streamRef.current = null
    ctxRef.current = null
  }, [])

  return { start, stop, error }
}
