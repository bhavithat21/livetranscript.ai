import { useRef, useState, useCallback } from 'react'
import { floatTo16BitPCM } from './pcm'

const TARGET_SAMPLE_RATE = 16000

export function useMicStream() {
  const [error, setError] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const start = useCallback(
    async (
      onPcm: (pcm: ArrayBuffer) => void,
      onLevel: (rms: number) => void,
    ): Promise<number> => {
      setError(null)
      try {
        // gUM sampleRate constraint is advisory + can perturb echo-cancel DSP; the AudioContext resamples.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        })
        streamRef.current = stream
        // Forcing 16k can throw NotSupportedError on some engines — fall back to the default rate.
        let ctx: AudioContext
        try {
          ctx = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
        } catch {
          ctx = new AudioContext()
        }
        ctxRef.current = ctx
        await ctx.audioWorklet.addModule('/worklet-processor.js')
        const source = ctx.createMediaStreamSource(stream)
        const node = new AudioWorkletNode(ctx, 'pcm-processor')
        node.port.onmessage = (ev: MessageEvent<{ samples: Float32Array; rms: number }>) => {
          const pcm = floatTo16BitPCM(ev.data.samples)
          // Copy into a fresh ArrayBuffer (pcm.buffer is typed ArrayBufferLike / possibly Shared).
          onPcm(pcm.slice().buffer as ArrayBuffer)
          onLevel(ev.data.rms)
        }
        source.connect(node)
        node.connect(ctx.destination)
        return ctx.sampleRate // actual rate — pass to the provider, not a hardcoded 16000
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Microphone access failed')
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
