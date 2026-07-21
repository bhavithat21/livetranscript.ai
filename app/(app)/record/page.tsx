'use client'
import { useCallback, useRef, useState } from 'react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { connectWithFallback } from '@/lib/transcription'
import { mergeSegments, applyCorrection, transcriptText, type Segment } from '@/lib/transcript/store'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { AudioMeter } from '@/components/transcript/AudioMeter'
import { saveSession, createShare } from './actions'
import type { TranscriptionProvider, TranscriptEvent } from '@/lib/transcription/types'

const KEYTERMS = ['Kubernetes', 'idempotency', 'quantization', 'Kafka', 'AWS Lambda', 'system design']

type Summary = { summary: string; keyPoints: string[]; actionItems: string[] }

// Correction track: on each finalized line, re-clean it server-side and swap in place. Fail-soft.
async function correctLine(
  id: number,
  e: TranscriptEvent,
  context: string,
  setSegments: (fn: (s: Segment[]) => Segment[]) => void,
) {
  try {
    const r = await fetch('/api/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: e.text, context, keyterms: KEYTERMS }),
    })
    if (!r.ok) return
    const { text } = await r.json()
    if (text && text !== e.text) setSegments((s) => applyCorrection(s, id, text))
  } catch {
    /* fail-soft: keep the live line */
  }
}

export default function RecordPage() {
  const { start, stop, error } = useMicStream()
  const [segments, setSegments] = useState<Segment[]>([])
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState(false)
  const [engine, setEngine] = useState<string | null>(null)
  const [reader, setReader] = useState(false)
  const [shadow, setShadow] = useState(false)
  const [shadowSpeaker, setShadowSpeaker] = useState(1) // Speaker 2 (the repeater) by default
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const providerRef = useRef<TranscriptionProvider | null>(null)
  const startedAtRef = useRef<number>(0)

  const onStart = useCallback(async () => {
    setSegments([])
    setSummary(null)
    setSavedId(null)
    setShareMsg(null)
    startedAtRef.current = Date.now()
    setBusy(true)
    try {
      // Open mic first so we know the REAL sample rate, then tell the provider that rate.
      let provider: TranscriptionProvider | null = null
      const actualRate = await start((pcm) => provider?.sendAudio(pcm), setLevel)
      const res = await connectWithFallback({
        keyterms: KEYTERMS,
        sampleRate: actualRate,
        maxSpeakers: 5,
      })
      provider = res.provider
      providerRef.current = provider
      setEngine(res.name)
      provider.onPartial((e) => setSegments((s) => mergeSegments(s, e)))
      provider.onFinal((e) => {
        setSegments((s) => {
          const merged = mergeSegments(s, e)
          const id = merged[merged.length - 1].id
          const context = transcriptText(merged.slice(-4, -1)) // recent finals for context
          void correctLine(id, e, context, setSegments)
          return merged
        })
      })
      setRecording(true)
    } catch (e) {
      stop()
      alert(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setBusy(false)
    }
  }, [start, stop])

  const onStop = useCallback(async () => {
    stop()
    await providerRef.current?.disconnect()
    setRecording(false)
    setLevel(0)
    const text = transcriptText(segments)
    if (text) {
      setBusy(true)
      try {
        const r = await fetch('/api/summarize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: text }),
        })
        const sum: Summary | null = r.ok ? await r.json() : null
        if (sum) setSummary(sum)
        // Persist the session (best-effort — needs auth + DB configured).
        try {
          const durationSeconds = Math.round((Date.now() - startedAtRef.current) / 1000)
          const { id } = await saveSession({
            title: 'Untitled session',
            language: 'en',
            durationSeconds,
            segments,
            summary: sum,
          })
          setSavedId(id)
        } catch {
          /* not signed in / no DB — transcript still shown, just not saved */
        }
      } finally {
        setBusy(false)
      }
    }
  }, [stop, segments])

  const onShare = useCallback(
    async (ttlHours: number, label: string) => {
      if (!savedId) return
      try {
        const { url } = await createShare(savedId, ttlHours)
        await navigator.clipboard.writeText(url)
        setShareMsg(`Link copied — expires in ${label}`)
      } catch {
        setShareMsg('Sharing needs sign-in + database')
      }
    },
    [savedId],
  )

  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      {!reader && (
        <header className="glass sticky top-0 z-40 flex flex-wrap items-center gap-4 rounded-b-2xl px-6 py-3">
          {!recording ? (
            <button
              onClick={onStart}
              disabled={busy}
              className="rounded-full bg-emerald-700 px-5 py-2 font-medium text-white disabled:opacity-50"
            >
              {busy ? 'Starting…' : 'Start Recording'}
            </button>
          ) : (
            <button
              onClick={onStop}
              className="rounded-full bg-red-700 px-5 py-2 font-medium text-white"
            >
              Stop
            </button>
          )}
          <AudioMeter level={level} />
          {engine && <span className="text-sm text-black/50">Engine: {engine}</span>}
          <label className="ml-auto flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={shadow}
              onChange={(e) => setShadow(e.target.checked)}
            />
            Shadow Mode
          </label>
          {shadow && (
            <div className="flex items-center gap-1 text-sm">
              <span className="text-black/50">Highlight:</span>
              <button
                onClick={() => setShadowSpeaker(0)}
                className={`rounded-full px-3 py-1 ${shadowSpeaker === 0 ? 'bg-black text-white' : 'border border-black/15'}`}
              >
                Speaker 1
              </button>
              <button
                onClick={() => setShadowSpeaker(1)}
                className={`rounded-full px-3 py-1 ${shadowSpeaker === 1 ? 'bg-black text-white' : 'border border-black/15'}`}
              >
                Speaker 2
              </button>
            </div>
          )}
          <button
            onClick={() => setReader(true)}
            className="text-sm underline underline-offset-4"
          >
            Reader Mode
          </button>
          {error && <span className="w-full text-sm text-red-700">{error}</span>}
        </header>
      )}
      {reader && (
        <button
          onClick={() => setReader(false)}
          className="fixed right-4 top-4 z-10 text-sm underline underline-offset-4"
        >
          Exit Reader
        </button>
      )}
      <TranscriptView
        segments={segments}
        theme="light"
        readerMode={reader}
        emphasizeSpeaker={shadow ? shadowSpeaker : null}
        autoScroll={recording}
      />
      {savedId && !reader && (
        <section className="glass mx-6 mb-4 mt-4 flex flex-wrap items-center gap-3 rounded-2xl p-4">
          <span className="text-sm font-medium">Share transcript:</span>
          <button
            onClick={() => onShare(1, '1 hour')}
            className="rounded-full border border-black/15 px-3 py-1 text-sm hover:bg-black/5"
          >
            1 hour
          </button>
          <button
            onClick={() => onShare(24, '24 hours')}
            className="rounded-full border border-black/15 px-3 py-1 text-sm hover:bg-black/5"
          >
            24 hours
          </button>
          <button
            onClick={() => onShare(168, '7 days')}
            className="rounded-full border border-black/15 px-3 py-1 text-sm hover:bg-black/5"
          >
            7 days
          </button>
          {shareMsg && <span className="text-sm text-emerald-700">{shareMsg}</span>}
        </section>
      )}
      {summary && !reader && (
        <section className="glass mx-6 mb-10 rounded-2xl p-5">
          <h2 className="mb-2 font-serif text-xl">Summary</h2>
          <p className="mb-4 leading-relaxed">{summary.summary}</p>
          {summary.keyPoints.length > 0 && (
            <div className="mb-4">
              <h3 className="mb-1 font-semibold">Key Points</h3>
              <ul className="list-disc pl-5">
                {summary.keyPoints.map((k, i) => (
                  <li key={i}>{k}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.actionItems.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold">Action Items</h3>
              <ul className="list-disc pl-5">
                {summary.actionItems.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  )
}
