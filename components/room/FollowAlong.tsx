'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { connectWithFallback } from '@/lib/transcription'
import { alignIndex } from '@/lib/room/shadowAlign'
import { ShadowFollow } from '@/components/transcript/ShadowFollow'
import type { TranscriptionProvider } from '@/lib/transcription/types'

// Speech-shadowing follow-along. The reader repeats a chosen line aloud; their OWN
// mic drives a rolling 3–5 word highlight on the source text (ShadowFollow) so
// they always see where they are now and what's next.
//
// LOW LATENCY: alignment is a pure local string match (alignIndex) — no model
// call per word. The only network hop is the reader's own ASR (same engine used
// to speak), and the highlight advances on each partial, not on a round-trip.
export function FollowAlong({
  source,
  keyterms,
  onClose,
}: {
  source: string
  keyterms: string[]
  onClose: () => void
}) {
  const words = source.split(/\s+/).filter(Boolean)
  const { start, stop, error } = useMicStream()
  const [spoken, setSpoken] = useState('')
  const [listening, setListening] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const providerRef = useRef<TranscriptionProvider | null>(null)

  // Active word index = how many source words the reader has covered so far.
  const activeIndex = alignIndex(words, spoken)

  const begin = useCallback(async () => {
    setStartError(null)
    setSpoken('')
    try {
      let provider: TranscriptionProvider | null = null
      const rate = await start((pcm) => provider?.sendAudio(pcm), () => {}, { source: 'mic' })
      // Fastest engine — this is a local alignment aid, accuracy of the reader's
      // echo matters less than immediacy.
      const res = await connectWithFallback({ keyterms, sampleRate: rate, maxSpeakers: 1 }, undefined, 'Deepgram')
      provider = res.provider
      providerRef.current = provider
      // Partials advance the cursor immediately; we track the latest line only.
      provider.onPartial((e) => setSpoken(e.text))
      provider.onFinal((e) => setSpoken(e.text))
      setListening(true)
    } catch (e) {
      stop()
      setStartError(e instanceof Error ? e.message : 'Could not start follow-along')
    }
  }, [start, stop, keyterms])

  const end = useCallback(async () => {
    stop()
    await providerRef.current?.disconnect()
    providerRef.current = null
    setListening(false)
  }, [stop])

  // Tear down the mic + ASR when the panel unmounts.
  useEffect(() => () => void end(), [end])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#faf9f7]/98 backdrop-blur-sm">
      <header className="flex items-center gap-3 px-6 py-4">
        <span className="text-sm font-medium uppercase tracking-widest text-emerald-700">
          Follow along
        </span>
        {listening && (
          <span className="flex items-center gap-1.5 text-sm text-[color:var(--stop)]">
            <span className="live-dot" aria-hidden /> Listening — repeat aloud
          </span>
        )}
        <button onClick={onClose} className="btn-ghost ml-auto flex items-center gap-1.5 text-sm">
          <X size={15} /> Close
        </button>
      </header>

      <div className="flex flex-1 items-center overflow-y-auto px-8 pb-32 pt-4">
        <ShadowFollow
          words={words}
          activeIndex={activeIndex}
          className="mx-auto max-w-3xl text-3xl sm:text-4xl"
        />
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-8 flex justify-center px-4">
        <div className="glass pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2.5">
          {!listening ? (
            <button onClick={begin} className="btn-signal">Start reading</button>
          ) : (
            <button onClick={end} className="btn-stop flex items-center gap-2">
              <span className="live-dot" aria-hidden /> Stop
            </button>
          )}
          {(startError || error) && (
            <span className="max-w-xs text-sm text-[color:var(--stop)]">{startError ?? error}</span>
          )}
        </div>
      </div>
    </div>
  )
}
