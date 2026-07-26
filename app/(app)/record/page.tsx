'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Mic, MicOff, Sparkles, X } from 'lucide-react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { connectWithFallback, type ProviderChoice } from '@/lib/transcription'
import { mergeSegments, applyCorrection, transcriptText, type Segment } from '@/lib/transcript/store'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { TextSizeControl } from '@/components/transcript/TextSizeControl'
import { useTextScale } from '@/lib/transcript/useTextScale'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { Waveform } from '@/components/transcript/Waveform'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { Select } from '@/components/ui/Select'
import { ShortcutHelp, MOD } from '@/components/ui/ShortcutHelp'
import { saveSession } from './actions'
import { createShare } from '../session-actions'
import { logError } from '@/lib/log'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import type { TranscriptionProvider, TranscriptEvent } from '@/lib/transcription/types'


type Summary = { summary: string; keyPoints: string[]; actionItems: string[] }

// Never surface the underlying vendor/model — show what the engine is good at.
function engineLabel(name: string): string {
  if (name === 'AssemblyAI') return 'High-accuracy engine'
  if (name === 'Deepgram') return 'Fast engine'
  return 'Live engine'
}

// Correction track: on each finalized line, re-clean it server-side and swap in place. Fail-soft.
async function correctLine(
  id: number,
  e: TranscriptEvent,
  context: string,
  keyterms: string[],
  setSegments: (fn: (s: Segment[]) => Segment[]) => void,
) {
  try {
    const r = await fetch('/api/correct', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: e.text, context, keyterms }),
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
  // Desktop app only: native system-audio tap (macOS ScreenCaptureKit / Windows
  // WASAPI loopback). Hears the whole call — incl. the Zoom desktop app, which a
  // browser tab can't on macOS. No-ops in the browser (start returns 0).
  const native = useNativeCapture()
  const { keyterms } = useKeytermPrefs() // user-selected vocab packs (base + overlays)
  const textScale = useTextScale() // reader text-size preference (localStorage)
  const [askOpen, setAskOpen] = useState(false) // copilot side panel
  const [segments, setSegments] = useState<Segment[]>([])
  const [level, setLevel] = useState(0)
  const [recording, setRecording] = useState(false)
  const [engine, setEngine] = useState<string | null>(null)
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('auto')
  // Default to System sound (getDisplayMedia loopback): a digital tap that never
  // contends with Zoom for the mic/speaker device and can't echo. Mic is opt-in.
  const [source, setSource] = useState<AudioSource>('system')
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
  // Latest keyterms outside the render cycle, so the onFinal closure uses the
  // current pack selection without being recreated.
  const keytermsRef = useRef<string[]>(keyterms)
  keytermsRef.current = keyterms

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
      // Capture starts before the provider WS opens; buffer those early chunks and
      // flush on connect so the first ~seconds of speech aren't dropped. Bounded to
      // ~3s (chunks are ~50ms) so a slow fallback connect can't grow it unbounded.
      const MAX_PENDING = 60
      const pending: ArrayBuffer[] = []
      const onPcm = (pcm: ArrayBuffer) => {
        if (provider) return provider.sendAudio(pcm)
        pending.push(pcm)
        if (pending.length > MAX_PENDING) pending.shift() // drop oldest
      }
      // Desktop + System source: try the native OS tap first (full-system audio,
      // no screen-share picker). Returns 0 in the browser / when not native; a
      // real native failure (permission denied, no device) REJECTS — catch it so
      // we still fall back to the browser path instead of hard-failing onStart.
      let nativeRate = 0
      if (source === 'system') {
        try {
          nativeRate = await native.start(onPcm, setLevel, { isMuted: () => mutedRef.current })
        } catch (err) {
          logError('record/native.start', err) // native tap failed — fall back to browser
        }
      }
      const actualRate =
        nativeRate ||
        (await start(onPcm, setLevel, { source, isMuted: () => mutedRef.current }))
      const res = await connectWithFallback(
        { keyterms: keytermsRef.current, sampleRate: actualRate, maxSpeakers: 5 },
        undefined,
        providerChoice,
      )
      provider = res.provider
      providerRef.current = provider
      for (const chunk of pending) provider.sendAudio(chunk) // flush pre-connect audio
      pending.length = 0
      setEngine(res.name)
      provider.onPartial((e) => setSegments((s) => mergeSegments(s, e)))
      provider.onFinal((e) => {
        setSegments((s) => {
          const merged = mergeSegments(s, e)
          const id = merged[merged.length - 1].id
          const context = transcriptText(merged.slice(-4, -1)) // recent finals for context
          void correctLine(id, e, context, keytermsRef.current, setSegments)
          return merged
        })
      })
      // Socket dropped after connect: surface it and stop the "recording" illusion
      // (kill the meter, flip recording off) — no silent dead session.
      provider.onStatus?.(({ error }) => {
        stop()
        void native.stop()
        setRecording(false)
        setLevel(0)
        setStartError(error)
      })
      setRecording(true)
    } catch (e) {
      stop()
      void native.stop() // native tap may have started before connect threw — don't leak it
      // Inline error (not alert) — a modal mid-async can wedge AudioContext on iOS Safari.
      setStartError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setBusy(false)
    }
  }, [start, stop, native, providerChoice, source])

  const onStop = useCallback(async () => {
    stop()
    void native.stop() // tear down the native tap too (no-op in the browser)
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
  }, [stop, native])

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

  // Copy the whole transcript to the clipboard (Mod+C when not selecting text).
  const onCopyTranscript = useCallback(async () => {
    const text = transcriptText(segmentsRef.current)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setShareMsg('Transcript copied')
    } catch (err) {
      logError('record/copyTranscript', err)
    }
  }, [])

  // Reset to a fresh capture (Mod+N) — mirrors the "New recording" button.
  const onNew = useCallback(() => {
    setSegments([])
    setSummary(null)
    setSavedId(null)
    setShareMsg(null)
    setReader(false)
  }, [])

  // Keyboard shortcuts. Plain keys: S start/stop, M/Space mute (live), R Reader,
  // Esc exit Reader. Mod combos: Mod+C copy transcript, Mod+S save (via Stop),
  // Mod+N new. "?" opens the help sheet (handled in ShortcutHelp).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()

      // Mod combos work even in text fields would be surprising, so still skip typing.
      if (mod && !typing) {
        if (k === 'c') {
          // Only hijack Copy when there's no active text selection — otherwise let
          // the native copy of the highlighted text through.
          if ((window.getSelection()?.toString() ?? '') === '') {
            e.preventDefault()
            void onCopyTranscript()
          }
          return
        }
        if (k === 's') {
          // Save = stop (which persists). No-op if already stopped/busy.
          e.preventDefault()
          if (recording && !busy) void onStop()
          return
        }
        if (k === 'n') {
          e.preventDefault()
          if (!recording) onNew()
          return
        }
        return
      }

      if (typing) return
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
  }, [recording, busy, reader, onStart, onStop, onCopyTranscript, onNew])

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
      <ShortcutHelp
        shortcuts={[
          { keys: 'S', label: recording ? 'Stop recording' : 'Start recording' },
          { keys: 'Space / M', label: 'Mute / unmute (while live)' },
          { keys: 'R', label: 'Toggle Reader Mode' },
          { keys: `${MOD}C`, label: 'Copy transcript' },
          { keys: `${MOD}S`, label: 'Save (stop & persist)' },
          { keys: `${MOD}N`, label: 'New transcript' },
          { keys: 'Esc', label: 'Exit Reader Mode' },
          { keys: `${MOD}⇧H`, label: 'Hide / show window (desktop)' },
        ]}
      />
      {/* Idle has no header — pin nav top-left so the launch screen isn't a dead end. */}
      {idle && (
        <div className="fixed left-4 top-4 z-50">
          <HomeMenu />
        </div>
      )}
      {/* Live telemetry rail — replaces the orphan status; shows on-air state + numbers. */}
      {!reader && !idle && (
        <header className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-4 sm:px-6">
          <HomeMenu />
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
            <span className="rounded-full bg-black/5 px-2.5 py-0.5 text-xs text-black/50">
              {engineLabel(engine)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <TextSizeControl
              onDec={textScale.dec}
              onInc={textScale.inc}
              canDec={textScale.canDec}
              canInc={textScale.canInc}
            />
            <button
              onClick={() => setAskOpen((v) => !v)}
              data-active={askOpen}
              className="btn-ghost flex items-center gap-1.5 text-sm data-[active=true]:border-emerald-700/40 data-[active=true]:text-emerald-800"
              title="Ask the transcript"
            >
              <Sparkles size={15} /> Ask
            </button>
            <button
              onClick={() => setReader(true)}
              className="btn-ghost flex items-center gap-1.5 text-sm"
            >
              <BookOpen size={15} /> Reader
            </button>
          </div>
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
          scale={textScale.scale}
          fade={recording && !reader}
          // Post-stop: let the PAGE scroll (main's pb-32 clears the floating
          // "New recording" button + avoids a double scroll with the summary).
          // While recording we keep the inner capped scroll for autoscroll + fade.
          flow={!recording && !reader}
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
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-3">
          <div className="glass dock-live pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-3xl px-4 py-2.5 sm:gap-3">
            <button
              onClick={() => setMuted((m) => !m)}
              data-active={muted}
              className="btn-ghost flex items-center gap-2 text-sm"
              title="Mute / unmute (M or Space)"
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              <span className="hidden sm:inline">{muted ? 'Muted' : 'Mic on'}</span>
            </button>
            <span className="hidden h-5 w-px bg-black/10 sm:block" aria-hidden />
            <Waveform level={level} active={recording && !muted} />
            {/* elapsed already shows in the header — hide on phones to save dock width */}
            <span className="hidden font-mono text-sm tabular-nums text-black/50 sm:inline">{elapsed}</span>
            <span className="hidden h-5 w-px bg-black/10 sm:block" aria-hidden />
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

      {/* Copilot: right-side drawer. Full-width sheet on phones, ~24rem column on
          desktop. Grounds each answer in the live transcript via segmentsRef. */}
      {askOpen && (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/10 sm:hidden"
            onClick={() => setAskOpen(false)}
            aria-hidden
          />
          <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-auto">
            <CopilotPanel
              getTranscript={() => transcriptText(segmentsRef.current)}
              onClose={() => setAskOpen(false)}
            />
          </div>
        </>
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
            <Select
              ariaLabel="Audio source"
              value={source}
              onChange={(v) => setSource(v)}
              disabled={busy}
              options={[
                { value: 'system', label: 'System sound (recommended)' },
                { value: 'mic', label: 'Microphone' },
              ]}
            />
          </label>
          {/* Echo/contention guidance: System sound is a digital loopback — it
              never grabs the mic/speaker device Zoom is using, so no echo and no
              device conflict. Mic is only for transcribing the physical room. */}
          <p className="-mt-1 text-xs leading-relaxed text-black/45">
            {source === 'system'
              ? 'Captures the call audio digitally — no echo, and it won’t conflict with Zoom/Meet using your mic or speakers.'
              : 'Only for the physical room you’re in. In a call this can echo and fight Zoom for the mic — use System sound instead.'}
          </p>
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-black/50">Engine</span>
            {/* Capability labels — never expose which vendor/model powers each. */}
            <Select
              ariaLabel="Transcription engine"
              value={providerChoice}
              onChange={(v) => setProviderChoice(v)}
              disabled={busy}
              title="How we transcribe — Auto picks the best engine for you"
              options={[
                { value: 'auto', label: 'Auto — best available' },
                { value: 'AssemblyAI', label: 'Highest accuracy' },
                { value: 'Deepgram', label: 'Fastest / lowest latency' },
              ]}
            />
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
