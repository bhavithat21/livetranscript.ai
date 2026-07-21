'use client'
import { useCallback, useRef, useState } from 'react'
import { useMicStream } from '@/lib/audio/useMicStream'
import { connectWithFallback } from '@/lib/transcription'
import { mergeSegments, applyCorrection, transcriptText, type Segment } from '@/lib/transcript/store'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { AudioMeter } from '@/components/transcript/AudioMeter'
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
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const providerRef = useRef<TranscriptionProvider | null>(null)

  const onStart = useCallback(async () => {
    setSegments([])
    setSummary(null)
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
        if (r.ok) setSummary(await r.json())
      } finally {
        setBusy(false)
      }
    }
  }, [stop, segments])

  return (
    <main className="min-h-dvh bg-[#faf9f7] text-[#16151a]">
      {!reader && (
        <header className="flex flex-wrap items-center gap-4 border-b border-black/10 px-6 py-3">
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
          <button
            onClick={() => setReader(true)}
            className="ml-auto text-sm underline underline-offset-4"
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
      <TranscriptView segments={segments} theme="light" readerMode={reader} />
      {summary && !reader && (
        <section className="mx-6 mb-10 rounded-lg border border-black/10 bg-white p-5">
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
