'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Mic, MicOff, X } from 'lucide-react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { connectWithFallback, type ProviderChoice } from '@/lib/transcription'
import { mergeSegments, applyCorrection, transcriptText, type Segment } from '@/lib/transcript/store'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { Waveform } from '@/components/transcript/Waveform'
import { saveSession } from './actions'
import { createShare } from '../session-actions'
import { logError } from '@/lib/log'
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
  } catch (err) {
    logError('record/correctLine', err) // fail-soft: keep the live line, but record it
  }
}

export default function RecordPage() {
  const { start, stop, error } = useMicStream()
  const [segments, setSegments] = useState<Segment[]>([])
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState(false)
  const [engine, setEngine] = useState<string | null>(null)
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('auto')
  const [source, setSource] = useState<AudioSource>('mic')
  const [reader, setReader] = useState(false)
  const [muted, setMuted] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [busy, setBusy] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [shareMsg, setShareMsg] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const providerRef = useRef<TranscriptionProvider | null>(null)
  const startedAtRef = useRef<number>(0)
  const mutedRef = useRef(false)
  mutedRef.current = muted
  // Latest segments, kept outside the render cycle so onStop reads the final
  // state (not a stale closure snapshot from when the callback was created).
  const segmentsRef = useRef<Segment[]>([])
  segmentsRef.current = segments

  const onStart = useCallback(async () => {
    setSegments([])
    setSummary(null)
    setSavedId(null)
    setShareMsg(null)
    setStartError(null)
    startedAtRef.current = Date.now()
    setBusy(true)
    try {
      // Open the source first so we know the REAL sample rate, then tell the provider.
      let provider: TranscriptionProvider | null = null
      const actualRate = await start((pcm) => provider?.sendAudio(pcm), setLevel, {
        source,
        isMuted: () => mutedRef.current,
      })
      const res = await connectWithFallback(
        { keyterms: KEYTERMS, sampleRate: actualRate, maxSpeakers: 5 },
        undefined,
        providerChoice,
      )
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
      // Inline error (not alert) — a modal mid-async can wedge AudioContext on iOS Safari.
      setStartError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setBusy(false)
    }
  }, [start, stop, providerChoice, source])

  const onStop = useCallback(async () => {
    stop()
    await providerRef.current?.disconnect()
    setRecording(false)
    setLevel(0)
    const finalSegments = segmentsRef.current // authoritative latest, not a stale closure
    const text = transcriptText(finalSegments)
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
            segments: finalSegments,
            summary: sum,
          })
          setSavedId(id)
        } catch (err) {
          // not signed in / no DB — transcript still shown, just not saved
          logError('record/saveSession', err)
        }
      } finally {
        setBusy(false)
      }
    }
  }, [stop])

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

  // Keyboard shortcuts: S start/stop, M or Space mute (while live), R Reader Mode, Esc exit Reader.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      const k = e.key.toLowerCase()
      if (e.key === 'Escape' && reader) return setReader(false)
      if (k === 'r') return setReader((v) => !v)
      if (k === 's' && !busy) {
        e.preventDefault()
        void (recording ? onStop() : onStart())
      }
      if (recording && (e.key === ' ' || k === 'm')) {
        e.preventDefault()
        setMuted((m) => !m)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [recording, busy, reader, onStart, onStop])

  const idle = !recording && segments.length === 0
  const elapsed = useElapsed(recording, startedAtRef.current)
  const words = useMemo(
    () =>
      segments
        .filter((s) => s.isFinal)
        .reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0),
    [segments],
  )

  return (
    <main className="relative min-h-dvh bg-[#faf9f7] pb-32 text-[#16151a]">
      {/* Live telemetry rail — replaces the orphan status; shows on-air state + numbers. */}
      {!reader && !idle && (
        <header className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
          {recording ? (
            <>
              <span className="flex items-center gap-1.5 text-sm text-[color:var(--stop)]">
                <span className="live-dot" aria-hidden />
                {muted ? 'Muted' : 'Recording'}
              </span>
              <span className="font-mono text-sm tabular-nums text-black/60">{elapsed}</span>
              <span className="text-sm text-black/40">{words.toLocaleString()} words</span>
            </>
          ) : (
            <span className="text-sm text-black/40">Stopped · {words.toLocaleString()} words</span>
          )}
          {engine && (
            <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs text-black/50">{engine}</span>
          )}
          <button
            onClick={() => setReader(true)}
            className="btn-ghost ml-auto flex items-center gap-1.5 text-sm"
          >
            <BookOpen size={15} /> Reader
          </button>
        </header>
      )}
      {reader && (
        <button
          onClick={() => setReader(false)}
          className="glass fixed right-4 top-4 z-50 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
        >
          <X size={15} /> Exit Reader
        </button>
      )}

      {idle ? (
        <LaunchConsole
          busy={busy}
          source={source}
          setSource={setSource}
          providerChoice={providerChoice}
          setProviderChoice={setProviderChoice}
          onStart={onStart}
          error={startError ?? error}
        />
      ) : (
        <TranscriptView
          segments={segments}
          theme="light"
          readerMode={reader}
          autoScroll={recording}
          fade={recording && !reader}
        />
      )}

      {(startError || error) && !reader && !idle && (
        <p className="mx-auto max-w-3xl px-6 pt-2 text-sm text-[color:var(--stop)]">{startError ?? error}</p>
      )}

      {summary && !reader && (
        <section className="rise-in mx-auto mb-6 mt-6 max-w-3xl reader-surface rounded-2xl p-6">
          <h2 className="mb-3 font-[family-name:var(--font-serif)] text-xl">Summary</h2>
          <p className="text-lg leading-relaxed text-black/80">{summary.summary}</p>
          {summary.keyPoints.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-black/40">Key points</h3>
              <ul className="space-y-1 text-black/80">
                {summary.keyPoints.map((k, i) => (
                  <li key={i} className="flex gap-2"><span className="text-[color:var(--signal)]">•</span>{k}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.actionItems.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold uppercase tracking-wide text-black/40">Action items</h3>
              <ul className="space-y-1 text-black/80">
                {summary.actionItems.map((a, i) => (
                  <li key={i} className="flex gap-2"><span className="text-[color:var(--signal)]">→</span>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {savedId && (
            <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-black/10 pt-4 text-sm">
              <span className="font-medium">Share:</span>
              <button onClick={() => onShare(1, '1 hour')} className="btn-ghost text-sm">1 hour</button>
              <button onClick={() => onShare(24, '24 hours')} className="btn-ghost text-sm">24 hours</button>
              <button onClick={() => onShare(168, '7 days')} className="btn-ghost text-sm">7 days</button>
              {shareMsg && <span className="text-[color:var(--signal)]">{shareMsg}</span>}
            </div>
          )}
        </section>
      )}

      {/* Bottom control dock. Live: zoned mute | waveform | stop with breathing glow.
          Post-stop: a single calm "New recording". Absent in idle (console owns it). */}
      {!reader && recording && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <div className="glass dock-live pointer-events-auto flex items-center gap-3 rounded-full px-4 py-2.5">
            <button
              onClick={() => setMuted((m) => !m)}
              data-active={muted}
              className="btn-ghost flex items-center gap-2 text-sm"
              title="Mute / unmute (M or Space)"
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              {muted ? 'Muted' : 'Mic on'}
            </button>
            <span className="h-5 w-px bg-black/10" aria-hidden />
            <Waveform level={level} active={recording && !muted} />
            <span className="font-mono text-sm tabular-nums text-black/50">{elapsed}</span>
            <span className="h-5 w-px bg-black/10" aria-hidden />
            <button onClick={onStop} className="btn-stop flex items-center gap-2" title="Stop (S)">
              <span className="live-dot" aria-hidden />
              Stop
            </button>
          </div>
        </div>
      )}
      {!reader && !recording && segments.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
          <button onClick={onStart} className="btn-signal glass pointer-events-auto flex items-center gap-2">
            <Mic size={16} /> New recording
          </button>
        </div>
      )}
    </main>
  )
}

// Live elapsed mm:ss, ticking each second while active. Note: Date.now() is used
// only in the browser at runtime (not during SSR/build), so it's safe here.
function useElapsed(active: boolean, startedAt: number): string {
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active, startedAt])
  const s = Math.max(0, Math.floor((now - startedAt) / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

// One centered launch console — the single center of gravity for the idle screen.
// Holds source + engine pickers AND the only Start button (no competing dock CTA).
function LaunchConsole({
  busy,
  source,
  setSource,
  providerChoice,
  setProviderChoice,
  onStart,
  error,
}: {
  busy: boolean
  source: AudioSource
  setSource: (s: AudioSource) => void
  providerChoice: ProviderChoice
  setProviderChoice: (p: ProviderChoice) => void
  onStart: () => void
  error: string | null
}) {
  return (
    <div className="grid min-h-[calc(100dvh-4rem)] place-items-center px-6">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        <p className="rise-in flex items-center gap-2 text-sm font-medium uppercase tracking-widest text-[color:var(--signal)]">
          <span className="h-1.5 w-1.5 rounded-full bg-black/25" /> Live transcription · ready
        </p>
        <h1
          className="rise-in mt-3 font-[family-name:var(--font-serif)] text-4xl leading-[1.05] tracking-[-0.01em] sm:text-5xl"
          style={{ animationDelay: '80ms' }}
        >
          Press record.
          <br />
          Every word, the moment it&rsquo;s said.
        </h1>

        <div
          className="rise-in glass mt-8 flex w-full flex-col gap-3 rounded-3xl p-5 text-left"
          style={{ animationDelay: '200ms' }}
        >
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-black/50">Source</span>
            <select
              aria-label="Audio source"
              value={source}
              onChange={(e) => setSource(e.target.value as AudioSource)}
              disabled={busy}
              className="rounded-full border border-black/15 bg-white/70 px-3 py-1.5 text-sm outline-none focus:border-emerald-700"
            >
              <option value="mic">Microphone</option>
              <option value="system">System sound</option>
            </select>
          </label>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-black/50">Engine</span>
            <select
              aria-label="Transcription engine"
              value={providerChoice}
              onChange={(e) => setProviderChoice(e.target.value as ProviderChoice)}
              disabled={busy}
              title="Live engine — OpenAI runs the accuracy correction pass on top"
              className="rounded-full border border-black/15 bg-white/70 px-3 py-1.5 text-sm outline-none focus:border-emerald-700"
            >
              <option value="auto">Auto (smart fallback)</option>
              <option value="AssemblyAI">AssemblyAI</option>
              <option value="Deepgram">Deepgram</option>
            </select>
          </label>
          <button
            onClick={onStart}
            disabled={busy}
            className="btn-signal mt-1 flex items-center justify-center gap-2 py-3 text-base"
            title="Start (S)"
          >
            <Mic size={18} /> {busy ? 'Starting…' : 'Start recording'}
          </button>
          {error && <p className="text-center text-sm text-[color:var(--stop)]">{error}</p>}
        </div>

        <p className="rise-in mt-4 font-mono text-xs text-black/35" style={{ animationDelay: '320ms' }}>
          <kbd>S</kbd> start/stop · <kbd>M</kbd> mute · <kbd>R</kbd> reader
        </p>
      </div>
    </div>
  )
}
