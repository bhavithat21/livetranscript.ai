'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AudioLines, BookOpen, FileText, Link2, Mic, MicOff, Sparkles, X } from 'lucide-react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { connectWithFallback, type ProviderChoice } from '@/lib/transcription'
import { mergeSegments, transcriptText, type Segment } from '@/lib/transcript/store'
import { TranscriptView } from '@/components/transcript/TranscriptView'
import { TextSizeControl } from '@/components/transcript/TextSizeControl'
import { useTextScale } from '@/lib/transcript/useTextScale'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { usePanelWidth } from '@/lib/copilot/usePanelWidth'
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

// Vendor identity is factual; model quality needs evaluation on the same audio.
function engineLabel(name: string): string {
  if (name === 'AssemblyAI') return 'Universal 3.5'
  if (name === 'Deepgram') return 'Nova-3'
  return 'Live transcription'
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
  const panel = usePanelWidth() // shared width so the transcript reflows beside the panel (not under it)
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
  const connectionAbort = useRef<AbortController | null>(null)
  const stoppingRef = useRef(false)
  const startedAtRef = useRef<number>(0)
  const [startedAt, setStartedAt] = useState(0)
  const mutedRef = useRef(false)
  // Latest segments, kept outside the render cycle so onStop reads the final
  // state (not a stale closure snapshot from when the callback was created).
  const segmentsRef = useRef<Segment[]>([])
  // Latest keyterms outside the render cycle, so the onFinal closure uses the
  // current pack selection without being recreated.
  const keytermsRef = useRef<string[]>(keyterms)
  useEffect(() => {
    mutedRef.current = muted
  }, [muted])
  useEffect(() => {
    keytermsRef.current = keyterms
  }, [keyterms])

  useEffect(() => () => {
    connectionAbort.current?.abort()
    const provider = providerRef.current
    providerRef.current = null
    void provider?.disconnect().catch(() => {})
  }, [])

  const onStart = useCallback(async () => {
    connectionAbort.current?.abort()
    const abort = new AbortController()
    connectionAbort.current = abort
    const previous = providerRef.current
    providerRef.current = null
    void previous?.disconnect().catch(() => {})
    segmentsRef.current = []
    setSegments([])
    setSummary(null)
    setSavedId(null)
    setShareMsg(null)
    setStartError(null)
    const startedAtNow = Date.now()
    startedAtRef.current = startedAtNow
    setStartedAt(startedAtNow)
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
        if (abort.signal.aborted) return
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
          abort.signal.throwIfAborted()
          logError('record/native.start', err) // native tap failed — fall back to browser
        }
      }
      abort.signal.throwIfAborted()
      const actualRate =
        nativeRate ||
        (await start(onPcm, setLevel, { source, isMuted: () => mutedRef.current }))
      abort.signal.throwIfAborted()
      const res = await connectWithFallback(
        { keyterms: keytermsRef.current, sampleRate: actualRate, maxSpeakers: 5, signal: abort.signal },
        undefined,
        providerChoice,
      )
      abort.signal.throwIfAborted()
      provider = res.provider
      providerRef.current = provider
      // Publish synchronously into the authoritative buffer. React updater
      // functions are pure; they must never schedule remote rewriting calls.
      const ingest = (event: TranscriptEvent) => {
        if (providerRef.current !== provider) return
        segmentsRef.current = mergeSegments(segmentsRef.current, event)
        setSegments(segmentsRef.current)
      }
      provider.onPartial(ingest)
      provider.onFinal(ingest)
      for (const chunk of pending) provider.sendAudio(chunk)
      pending.length = 0
      setEngine(res.name)
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
      if (abort.signal.aborted) return
      stop()
      void native.stop() // native tap may have started before connect threw — don't leak it
      // Inline error (not alert) — a modal mid-async can wedge AudioContext on iOS Safari.
      setStartError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      if (!abort.signal.aborted) setBusy(false)
    }
  }, [start, stop, native, providerChoice, source])

  const onStop = useCallback(async () => {
    if (stoppingRef.current) return
    stoppingRef.current = true
    const stoppedAt = Date.now()
    setBusy(true)
    stop()
    try { await native.stop() } catch (err) { logError('record/native.stop', err) }
    const provider = providerRef.current
    try { await provider?.disconnect() } catch (err) { logError('record/disconnect', err) }
    if (providerRef.current === provider) providerRef.current = null
    connectionAbort.current?.abort()
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
          signal: AbortSignal.timeout(20_000),
        }).catch(() => null)
        const sum: Summary | null = r?.ok ? await r.json().catch(() => null) : null
        if (sum) setSummary(sum)
        // Persist the session (best-effort — needs auth + DB configured).
        try {
          const durationSeconds = Math.round((stoppedAt - startedAtRef.current) / 1000)
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
        setBusy(false); stoppingRef.current = false
      }
    } else { setBusy(false); stoppingRef.current = false }
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
  const elapsed = useElapsed(recording, startedAt)
  const words = useMemo(
    () =>
      segments
        .filter((s) => s.isFinal)
        .reduce((n, s) => n + (s.text.trim() ? s.text.trim().split(/\s+/).length : 0), 0),
    [segments],
  )

  return (
    <main
      // When the Ask panel is open on desktop, reserve its width as right-padding
      // (sm:pr reads --ask-w, defaulting to 0 when the panel is closed) so the
      // transcript reflows into the remaining space instead of being covered by
      // the overlay. Mobile keeps the full-screen sheet (no sm: padding).
      className={`relative min-h-dvh bg-[color:var(--paper)] text-ink sm:pr-[var(--ask-w,0px)] sm:transition-[padding] sm:duration-200 ${idle ? 'pb-10' : 'pb-32'}`}
      style={askOpen ? ({ '--ask-w': `${panel.width}px` } as React.CSSProperties) : undefined}
    >
      <title>Transcript — LiveTranscript</title>
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
      {idle && (
        <header className="flex min-h-18 items-center justify-between gap-4 border-b border-[color:var(--line)] bg-[color:var(--reader)] px-4 py-3 sm:px-6">
          <HomeMenu />
          <Link href="/dashboard" className="btn-ghost gap-2 text-sm"><FileText size={15} aria-hidden />Transcripts</Link>
        </header>
      )}
      {/* Live telemetry rail — replaces the orphan status; shows on-air state + numbers. */}
      {!reader && !idle && (
        <header className="mx-auto mb-4 flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2 border-b border-[color:var(--line)] px-4 py-4 sm:px-6">
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
            <span className="rounded-md border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--muted)]">
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
              aria-pressed={askOpen}
              className="btn-ghost flex items-center gap-1.5 text-sm data-[active=true]:border-[color:var(--signal)]/40 data-[active=true]:text-[color:var(--signal)]"
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
          className="btn-ghost fixed right-4 top-4 z-50 flex items-center gap-1.5 text-sm"
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
        <p role="alert" className="mx-auto max-w-3xl px-6 pt-2 text-sm text-[color:var(--stop)]">{startError ?? error}</p>
      )}

      {summary && !reader && (
        <section className="reader-surface mx-4 mb-6 mt-6 rounded-xl p-5 sm:mx-auto sm:max-w-3xl sm:p-6">
          <h2 className="mb-3 text-xl font-semibold tracking-tight">Summary</h2>
          <p className="text-lg leading-relaxed text-black/80">{summary.summary}</p>
          {summary.keyPoints.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold text-[color:var(--muted)]">Key points</h3>
              <ul className="space-y-1 text-black/80">
                {summary.keyPoints.map((k, i) => (
                  <li key={i} className="flex gap-2"><span className="text-[color:var(--signal)]">•</span>{k}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.actionItems.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-1.5 text-sm font-semibold text-[color:var(--muted)]">Action items</h3>
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
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center sm:right-[var(--ask-w,0px)] px-3">
          <div className="glass dock-live pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-xl px-4 py-2.5 sm:gap-3">
            <button
              onClick={() => setMuted((m) => !m)}
              data-active={muted}
              aria-pressed={muted}
              aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              className="btn-ghost flex items-center gap-2 text-sm"
              title="Mute / unmute (M or Space)"
            >
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              <span className="hidden sm:inline">{muted ? 'Muted' : 'Audio on'}</span>
            </button>
            <span className="hidden h-5 w-px bg-black/10 sm:block" aria-hidden />
            <Waveform level={level} active={recording && !muted} />
            {/* elapsed already shows in the header — hide on phones to save dock width */}
            <span className="hidden font-mono text-sm tabular-nums text-black/50 sm:inline">{elapsed}</span>
            <span className="hidden h-5 w-px bg-black/10 sm:block" aria-hidden />
            <button onClick={onStop} disabled={busy} aria-busy={busy} className="btn-stop flex items-center gap-2" title="Stop (S)">
              <span className="live-dot" aria-hidden />
              Stop
            </button>
          </div>
        </div>
      )}
      {!reader && !recording && segments.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center sm:right-[var(--ask-w,0px)] px-4">
          <button onClick={onStart} className="btn-signal glass pointer-events-auto flex items-center gap-2">
            <Mic size={16} /> New recording
          </button>
        </div>
      )}

      {/* Copilot: side-by-side panel on desktop (the transcript reflows beside it
          via main's sm:pr above), full-screen sheet on phones. */}
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
              width={panel.width}
              onResizeStart={panel.onResizeStart}
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
    <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-10 sm:px-6 sm:py-16 lg:min-h-[calc(100dvh-9rem)] lg:grid-cols-[1fr_1.1fr] lg:items-center lg:gap-16">
      <div>
        <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] text-[color:var(--signal)]"><AudioLines size={24} aria-hidden /></span>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">New transcript</h1>
        <p className="mt-3 max-w-md text-base leading-7 text-[color:var(--muted)]">Keep up with the conversation. Capture the audio you choose, read along, then review what matters.</p>
        <div className="mt-8 space-y-5">
          {[
            { icon: AudioLines, title: 'Follow the conversation', text: 'Live text with adjustable type and a focused reading view.' },
            { icon: FileText, title: 'Review the key details', text: 'A summary, key points and action items after you stop.' },
            { icon: Link2, title: 'Share on your terms', text: 'Export your transcript or create a link with an expiry.' },
          ].map(({ icon: Icon, title, text }) => <div key={title} className="flex gap-3"><Icon size={17} className="mt-0.5 shrink-0 text-[color:var(--muted)]" aria-hidden /><div><h2 className="text-sm font-medium">{title}</h2><p className="mt-1 text-sm leading-6 text-[color:var(--muted)]">{text}</p></div></div>)}
        </div>
      </div>

      <section aria-labelledby="recording-setup-title" className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-7">
        <div className="mb-6 flex items-center justify-between gap-3"><h2 id="recording-setup-title" className="text-lg font-semibold tracking-tight">Recording setup</h2><span className="rounded-md bg-[color:var(--surface-soft)] px-2 py-1 text-xs text-[color:var(--muted)]">{busy ? 'Connecting' : 'Not recording'}</span></div>
        <div className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium">Audio source</p>
            <Select ariaLabel="Audio source" value={source} onChange={setSource} disabled={busy} className="[&>button]:min-h-11 [&>button]:w-full [&>button]:justify-between [&>button]:rounded-lg [&>ul]:w-full" options={[
              { value: 'system', label: 'System sound' },
              { value: 'mic', label: 'Microphone' },
            ]} />
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">{source === 'system' ? 'Captures the selected call or browser audio, not necessarily your own microphone. For both sides, use Live Interview with Mic + System. Audio availability depends on your browser and operating system.' : 'For people speaking in the room. Your device will ask for microphone access.'}</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium">Transcription engine</p>
            <Select ariaLabel="Transcription engine" value={providerChoice} onChange={setProviderChoice} disabled={busy} className="[&>button]:min-h-11 [&>button]:w-full [&>button]:justify-between [&>button]:rounded-lg [&>ul]:w-full" options={[
              { value: 'auto', label: 'Auto — with fallback' },
              { value: 'AssemblyAI', label: 'AssemblyAI · Universal 3.5' },
              { value: 'Deepgram', label: 'Deepgram · Nova-3' },
            ]} />
            <p className="mt-2 text-xs leading-5 text-[color:var(--muted)]">Auto connects an available engine and can fall back if it is unavailable.</p>
          </div>
        </div>
        <div className="mt-6 border-t border-[color:var(--line)] pt-5">
          <button onClick={onStart} disabled={busy} aria-busy={busy} className="btn-signal flex w-full items-center justify-center gap-2 py-3 text-sm" title="Start (S)"><Mic size={17} aria-hidden />{busy ? 'Starting recording…' : 'Start recording'}</button>
          <p className="mt-3 text-center text-xs leading-5 text-[color:var(--muted)]">Audio starts after you grant access. Make sure everyone involved agrees to transcription.</p>
          <p className="mt-3 text-center text-xs leading-5 text-[color:var(--muted)]">Recognized wording is preserved. <Link href="/settings#audio" className="font-medium text-[color:var(--signal)] underline underline-offset-4">Tune phrase breaks and vocabulary</Link></p>
          {error && <p role="alert" className="mt-3 text-sm text-[color:var(--stop)]">{error}</p>}
        </div>
        <p className="mt-5 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-[color:var(--muted)]"><span><kbd className="font-mono">S</kbd> Start / stop</span><span><kbd className="font-mono">M</kbd> Mute</span><span><kbd className="font-mono">R</kbd> Reader</span></p>
      </section>
    </div>
  )
}
