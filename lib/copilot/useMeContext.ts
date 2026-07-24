'use client'
import { useCallback, useRef, useState } from 'react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { connectWithFallback } from '@/lib/transcription'
import type { TranscriptionProvider } from '@/lib/transcription/types'

// "Me context" — an OPT-IN, second ASR stream on the user's MICROPHONE that keeps
// a rolling buffer of what the USER said. It is deliberately separate from the
// visible transcript (which is fed by system-audio loopback): the user's words
// ground the AI's answers but never appear in the transcript.
//
// Non-disruptive by design: the mic is opened in shared mode (getUserMedia with
// echoCancellation/noiseSuppression) — modern macOS/Windows let multiple apps
// read the same mic at once, so this does NOT take the device away from Zoom.
// Off by default; fully torn down on stop. System audio is untouched.

const MAX_CHARS = 4_000 // rolling window of recent "me" speech

export function useMeContext() {
  const { start, stop, error } = useMicStream()
  const [listening, setListening] = useState(false)
  const providerRef = useRef<TranscriptionProvider | null>(null)
  // Rolling text kept outside render so the copilot reads the latest without re-renders.
  const bufferRef = useRef('')

  const startListening = useCallback(async () => {
    if (providerRef.current) return
    try {
      let provider: TranscriptionProvider | null = null
      const rate = await start((pcm) => provider?.sendAudio(pcm), () => {}, { source: 'mic' })
      // Fast engine — this is context, not a saved transcript; immediacy > polish.
      const res = await connectWithFallback({ keyterms: [], sampleRate: rate, maxSpeakers: 1 }, undefined, 'Deepgram')
      provider = res.provider
      providerRef.current = provider
      provider.onFinal((e) => {
        if (!e.text.trim()) return
        bufferRef.current = (bufferRef.current + ' ' + e.text).trim().slice(-MAX_CHARS)
      })
      setListening(true)
    } catch {
      stop()
      setListening(false)
    }
  }, [start, stop])

  const stopListening = useCallback(async () => {
    stop()
    await providerRef.current?.disconnect()
    providerRef.current = null
    setListening(false)
  }, [stop])

  // Latest "what I said" for grounding an answer (null when empty/off).
  const getMeContext = useCallback((): string | null => bufferRef.current.trim() || null, [])

  return { listening, error, startListening, stopListening, getMeContext }
}
