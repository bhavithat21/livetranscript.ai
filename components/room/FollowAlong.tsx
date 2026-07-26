'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { connectWithFallback } from '@/lib/transcription'
import { alignIndex, sourceKeyterms } from '@/lib/room/shadowAlign'
import { ShadowFollow } from '@/components/transcript/ShadowFollow'
import type { TranscriptionProvider } from '@/lib/transcription/types'

// Speech-shadowing follow-along. Shows the recent conversation: previous turns
// dimmed as CONTEXT above, and the current (live, growing) turn below with a
// growing highlight trail — the reader repeats aloud and their OWN mic drives the
// trail forward. They always see what was said before, what they're on now, and
// what's next. `source` grows live; `context` is the surrounding conversation.
//
// LOW LATENCY: alignment is a pure local string match (alignIndex) — no model
// call per word. Only network hop is the reader's own ASR; the trail advances on
// each ASR partial, not on a round-trip. Alignment runs on the CURRENT turn only
// so the reader's first words lock on reliably (no distant-history mismatch).
export function FollowAlong({
  source,
  context,
  keyterms,
  onClose,
}: {
  source: string
  context?: string
  keyterms: string[]
  onClose: () => void
}) {
  const words = source.split(/\s+/).filter(Boolean)
  const { start, stop, error } = useMicStream()
  const [spoken, setSpoken] = useState('')
  const [listening, setListening] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const providerRef = useRef<TranscriptionProvider | null>(null)
  // Freshest source for keyterm bias at begin() time, without re-creating begin
  // on every live word.
  const sourceRef = useRef(source)
  sourceRef.current = source

  // Active word index = how many source words the reader has covered so far.
  const activeIndex = alignIndex(words, spoken)

  const begin = useCallback(async () => {
    // In-flight guard: `listening`/`starting` flip via state and the Start button
    // is disabled while `starting`, so a double-click can't open a second mic
    // stream (the only trigger for begin() is that button — no keyboard path).
    setStarting(true)
    setStartError(null)
    setSpoken('')
    try {
      let provider: TranscriptionProvider | null = null
      const rate = await start((pcm) => provider?.sendAudio(pcm), () => {}, { source: 'mic' })
      // Accuracy win at zero latency cost: bias the engine toward the EXACT words
      // being read (sent once at open, not per word). Source terms first so they
      // survive the 100-cap, then the user's packs.
      const boosted = [...sourceKeyterms(sourceRef.current), ...keyterms]
      // Fastest engine — immediacy matters most here; the source-term bias keeps
      // positioning accurate even on the fast path.
      const res = await connectWithFallback({ keyterms: boosted, sampleRate: rate, maxSpeakers: 1 }, undefined, 'Deepgram')
      provider = res.provider
      providerRef.current = provider
      // Partials advance the cursor immediately; track the latest line spoken.
      provider.onPartial((e) => setSpoken(e.text))
      provider.onFinal((e) => setSpoken(e.text))
      setListening(true)
    } catch (e) {
      stop()
      setStartError(e instanceof Error ? e.message : 'Could not start follow-along')
    } finally {
      setStarting(false)
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
        {listening ? (
          <span className="flex items-center gap-1.5 text-sm text-[color:var(--stop)]">
            <span className="live-dot" aria-hidden /> Listening — repeat aloud
          </span>
        ) : (
          <span className="text-sm text-black/45">Tap start, then read the highlighted words aloud</span>
        )}
        <button onClick={onClose} className="btn-ghost ml-auto flex items-center gap-1.5 text-sm">
          <X size={15} /> Close
        </button>
      </header>

      <div className="flex flex-1 flex-col overflow-y-auto px-8 pb-32 pt-4">
        <div className="mx-auto w-full max-w-3xl">
          {/* Previous conversation — context so the reader keeps the thread. */}
          {context && (
            <p className="mb-6 border-l-2 border-black/10 pl-4 text-lg leading-relaxed text-black/35">
              {context}
            </p>
          )}
          {/* The live turn with the growing highlight trail. */}
          <ShadowFollow
            words={words}
            activeIndex={activeIndex}
            className="text-3xl sm:text-4xl"
          />
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-8 flex justify-center px-4">
        <div className="glass pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2.5">
          {!listening ? (
            <button onClick={begin} disabled={starting} className="btn-signal disabled:opacity-50">{starting ? 'Starting…' : 'Start reading'}</button>
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
