'use client'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, AudioLines, BookOpen, Check, ChevronDown, ChevronUp, Copy, Info, Link2, Link2Off, Lock, Mic, MicOff, Sparkles, Users } from 'lucide-react'
import { useMicStream, type AudioSource } from '@/lib/audio/useMicStream'
import { useNativeCapture } from '@/lib/audio/useNativeCapture'
import { logError } from '@/lib/log'
import { connectWithFallback } from '@/lib/transcription'
import { transcriptText, type Segment } from '@/lib/transcript/store'
import { useRoom } from '@/lib/room/useRoom'
import { useDisplayName } from '@/lib/auth/useDisplayName'
import { mergeRoomSegments, MAX_SPEAKERS, isStrongRoomId } from '@/lib/room/roomStore'
import { newRoomId } from '@/lib/room/roomId'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import { useSpeakerPrefs } from '@/lib/room/useSpeakerPrefs'
import { speakerColor } from '@/lib/speakers/palette'
import { TranscriptView, type SpeakerOverrides } from '@/components/transcript/TranscriptView'
import { ChatView } from '@/components/transcript/ChatView'
import { TextSizeControl } from '@/components/transcript/TextSizeControl'
import { useTextScale } from '@/lib/transcript/useTextScale'
import { useThemeMode } from '@/lib/transcript/useThemeMode'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { Waveform } from '@/components/transcript/Waveform'
import { Select } from '@/components/ui/Select'
import { ShortcutHelp, MOD } from '@/components/ui/ShortcutHelp'
import { RosterPanel } from '@/components/room/RosterPanel'
import { FollowAlong } from '@/components/room/FollowAlong'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { useLockMode } from '@/lib/desktop/useLockMode'
import { LeverSwitch } from '@/components/ui/LeverSwitch'
import { usePanelWidth } from '@/lib/copilot/usePanelWidth'
import { HomeMenu } from '@/components/nav/HomeMenu'
import type { TranscriptionProvider } from '@/lib/transcription/types'


export default function RoomPage() {
  // useParams (not `use(params)`): it's reactive, so client navigation BETWEEN two
  // /room/[id] routes (e.g. pasting a different link + Go) re-renders with the new
  // id instead of staying stuck on the first — that stuck read was why "Go" only
  // updated the id and never moved you into the new meeting.
  const id = String(useParams().id ?? '')
  const router = useRouter()
  const searchParams = useSearchParams()
  const autoJoin = searchParams.get('join') === '1'

  // "/room/new" → mint a unique meeting id and redirect, so each meeting is its own channel.
  useEffect(() => {
    if (id === 'new') router.replace(`/room/${newRoomId()}`)
  }, [id, router])

  if (id === 'new') {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center"><title>Creating meeting — LiveTranscript</title><p role="status" className="text-sm text-[color:var(--muted)]">Creating your meeting…</p></main>
    )
  }

  // Reject guessable / enumerable ids — real meetings arrive via a shared random link.
  if (!isStrongRoomId(id)) return <InvalidRoom />

  // A room-id or ?join transition must start with fresh join state, while a normal
  // re-render on the same URL must preserve a manual lobby join. Keying this small
  // state owner gives both guarantees without synchronously resetting state in an
  // effect (and avoids reviving A's joined state after A → B → A navigation).
  return <><title>Meeting — LiveTranscript</title><RoomSession key={`${id}:${autoJoin ? 'join' : 'lobby'}`} roomId={id} autoJoin={autoJoin} /></>
}

function RoomSession({ roomId, autoJoin }: { roomId: string; autoJoin: boolean }) {
  const [joined, setJoined] = useState(autoJoin)
  if (!joined) return <Lobby roomId={roomId} onJoin={() => setJoined(true)} />
  return <Meeting roomId={roomId} />
}

function InvalidRoom() {
  return (
    <main className="mx-auto max-w-lg px-4 py-10 sm:px-6 sm:py-16"><title>Meeting unavailable — LiveTranscript</title>
      <HomeMenu />
      <div className="mt-6 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-7">
        <span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-[color:var(--surface-soft)] text-[color:var(--muted)]"><Link2Off size={22} aria-hidden /></span>
        <h1 className="text-2xl font-semibold tracking-tight">This meeting link isn’t valid</h1>
        <p className="mt-3 text-sm leading-6 text-[color:var(--muted)]">Ask the host for their full invitation link, or create a new meeting to share with your group.</p>
        <Link href="/room/new" className="btn-signal mt-6 gap-2 text-sm"><Users size={16} aria-hidden />Create a meeting</Link>
      </div>
    </main>
  )
}

function subscribeToLocation(): () => void {
  return () => {}
}

function getLocationOrigin(): string {
  return window.location.origin
}

function Lobby({ roomId, onJoin }: { roomId: string; onJoin: () => void }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const [joinId, setJoinId] = useState('')
  const [joinError, setJoinError] = useState<string | null>(null)
  const joinRef = useRef<HTMLInputElement>(null)
  useThemeMode()

  const origin = useSyncExternalStore(subscribeToLocation, getLocationOrigin, () => '')
  const link = origin ? `${origin}/room/${roomId}` : `/room/${roomId}`
  const copyInvite = async () => {
    setCopyError(null)
    try { await navigator.clipboard.writeText(link); setCopied(true) }
    catch { setCopyError('Copying was unavailable. Select and copy the invitation link below.') }
  }
  const mailto =
    `mailto:?subject=${encodeURIComponent('Join my LiveTranscript meeting')}` +
    `&body=${encodeURIComponent(`Join the live transcript meeting:\n${link}\n\nMeeting ID: ${roomId}`)}`

  return (
    <main className="mx-auto max-w-5xl px-4 pb-16 pt-5 sm:px-6 sm:pt-8">
      <div className="mb-10 flex items-center justify-between gap-3">
        <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push('/dashboard'))} className="btn-ghost gap-1.5 text-sm"><ArrowLeft size={15} aria-hidden />Back</button>
        <ThemeToggle label />
      </div>
      <div className="grid gap-8 lg:grid-cols-[1fr_1.05fr] lg:gap-14">
        <div className="lg:pt-5">
          <span className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] text-[color:var(--signal)]"><Users size={23} aria-hidden /></span>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">A shared place for every word.</h1>
          <p className="mt-4 max-w-md text-base leading-7 text-[color:var(--muted)]">Join the same transcript from your own devices. Each speaker gets a clear identity, so everyone can follow the conversation.</p>
          <div className="mt-7 flex gap-3 rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] p-4"><AudioLines size={19} className="mt-0.5 shrink-0 text-[color:var(--signal)]" aria-hidden /><p className="text-sm leading-6 text-[color:var(--muted)]">Keep your voice call open in your meeting app. This room shares the transcript, not the call audio. Up to {MAX_SPEAKERS} participants can transcribe at once.</p></div>
        </div>

        <div>
          <section aria-labelledby="meeting-invitation" className="rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-5 sm:p-7">
            <div className="mb-6 flex items-center justify-between gap-2"><h2 id="meeting-invitation" className="text-lg font-semibold tracking-tight">Ready to join</h2><span className="rounded-md bg-[color:var(--surface-soft)] px-2 py-1 text-xs text-[color:var(--muted)]">Not transcribing</span></div>
            <p className="text-xs font-medium text-[color:var(--muted)]">Meeting ID</p>
            <div className="mt-2 flex items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] py-1 pl-3 pr-1">
              <span className="min-w-0 flex-1 select-all break-all font-mono text-sm">{roomId}</span>
              <button type="button" onClick={async () => { setCopyError(null); try { await navigator.clipboard.writeText(roomId); setIdCopied(true) } catch { setCopyError('Copying was unavailable. Select and copy the invitation link below.') } }} className="btn-ghost h-11 w-11 shrink-0 !px-0" title="Copy meeting ID" aria-label={idCopied ? 'Meeting ID copied' : 'Copy meeting ID'}>{idCopied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}</button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={copyInvite} className="btn-ghost gap-2 text-sm"><Link2 size={14} aria-hidden />{copied ? 'Invite link copied' : 'Copy invite link'}</button><a href={mailto} className="btn-ghost text-sm">Invite by email</a></div>
            {copyError && <div className="mt-3"><p role="status" className="text-xs leading-5 text-[color:var(--muted)]">{copyError}</p><label className="mt-2 block text-xs font-medium">Invitation link<input readOnly value={link} onFocus={(event) => event.target.select()} className="mt-1.5 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 py-2.5 text-sm font-normal" /></label></div>}
            <div className="mt-6 border-t border-[color:var(--line)] pt-5"><button type="button" onClick={onJoin} className="btn-signal w-full gap-2 py-3 text-sm"><Users size={17} aria-hidden />Join meeting</button><p className="mt-3 text-center text-xs leading-5 text-[color:var(--muted)]">You join as a listener. Start transcription when you’re ready.</p></div>
          </section>

          <form noValidate className="mt-6" onSubmit={(event) => {
            event.preventDefault()
            const raw = (joinId.trim().split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '')
            const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '')
            if (!isStrongRoomId(clean)) { setJoinError('Paste a complete meeting invitation or a valid meeting ID.'); joinRef.current?.focus(); return }
            if (clean === roomId) return onJoin()
            router.push(`/room/${clean}?join=1`)
          }}>
            <label htmlFor="join-id" className="mb-2 block text-sm font-medium">Joining a different meeting?</label>
            <div className="flex items-center gap-2"><input ref={joinRef} id="join-id" name="joinId" value={joinId} onChange={(event) => { setJoinId(event.target.value); setJoinError(null) }} placeholder="Paste an invitation link or meeting ID" aria-invalid={Boolean(joinError)} aria-describedby={joinError ? 'join-error' : undefined} className="min-h-11 min-w-0 flex-1 rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 text-sm outline-none focus:border-[color:var(--signal)]" /><button type="submit" className="btn-ghost text-sm">Join</button></div>
            {joinError && <p id="join-error" role="alert" className="mt-2 text-sm text-[color:var(--stop)]">{joinError}</p>}
          </form>
        </div>
      </div>
    </main>
  )
}

// The meeting id as a one-tap copyable chip — copies the full join link so it's
// trivial to paste to whoever should join. Friendly ids read aloud fine too.
function CopyMeetingId({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false)
  const [failedLink, setFailedLink] = useState<string | null>(null)
  const copy = async () => {
    const link = `${window.location.origin}/room/${roomId}`
    setFailedLink(null)
    try { await navigator.clipboard.writeText(link); setCopied(true) }
    catch { setFailedLink(link) }
  }
  return (
    <div className="relative min-w-0 max-w-full">
      <button type="button" onClick={copy} className="btn-ghost flex max-w-full items-center gap-2 text-sm" title="Copy the join link" aria-label={copied ? 'Meeting invitation copied' : 'Copy meeting invitation'}><span className="min-w-0 truncate font-mono text-xs">{roomId}</span>{copied ? <Check size={14} className="shrink-0 text-[color:var(--signal)]" aria-hidden /> : <Copy size={14} className="shrink-0" aria-hidden />}</button>
      {failedLink && <div className="absolute left-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw_-_2rem)] rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] p-3 shadow-lg"><p role="status" className="text-xs text-[color:var(--muted)]">Select and copy this invitation link.</p><label className="mt-2 block text-xs font-medium">Invitation link<input readOnly value={failedLink} onFocus={(event) => event.target.select()} className="mt-1 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-soft)] px-2 py-2 text-xs font-normal" /></label><button type="button" onClick={() => setFailedLink(null)} className="btn-ghost mt-2 text-xs">Close</button></div>}
    </div>
  )
}

function Meeting({ roomId }: { roomId: string }) {
  const router = useRouter()
  const displayName = useDisplayName()
  const { keyterms } = useKeytermPrefs()
  const textScale = useTextScale() // reader text-size preference (localStorage)
  const themeMode = useThemeMode() // light/dark reading surface (localStorage)
  const { start, stop, error } = useMicStream()
  // Desktop app only: native system-audio tap (macOS ScreenCaptureKit / Windows
  // WASAPI loopback). No-ops in the browser (start returns 0 → mic path).
  const native = useNativeCapture()
  const {
    connected,
    error: roomError,
    publish,
    onPeer,
    onEnd: onRoomEnd,
    endMeeting,
    roster,
    members,
    setPresenceSource,
    mySlot,
    myClientId,
  } = useRoom(roomId, displayName)
  const { prefs, setPref } = useSpeakerPrefs(roomId)
  const [segments, setSegments] = useState<Segment[]>([])
  const [level, setLevel] = useState(0)
  const [live, setLive] = useState(false)
  // In-flight guard: `live` only flips true AFTER the ~1-2s connect, so without
  // `starting` a double-click / double-tap-S re-enters onStart and opens a second
  // capture whose stream ref is orphaned (mic stays hot, can't be stopped). The
  // Start button is disabled and the S-key gated on it too.
  const [starting, setStarting] = useState(false)
  const [muted, setMuted] = useState(false)
  // Default to System sound (getDisplayMedia loopback) — no echo, no device
  // contention with Zoom/Meet. Mic is opt-in for the physical room only.
  const [source, setSource] = useState<AudioSource>('system')
  const [view, setView] = useState<'transcript' | 'chat'>('chat')
  const [showRoster, setShowRoster] = useState(false)
  const [askOpen, setAskOpen] = useState(false) // copilot side panel
  // Collapse the meeting chrome (identity, meeting-id, roster, status, toggles) so
  // the transcript gets the whole viewport for reading. A slim always-visible bar
  // re-expands it; End stays reachable even while collapsed.
  const [headerCollapsed, setHeaderCollapsed] = useState(false)
  // Fullscreen Reader mode (like /record): distraction-free reading surface.
  const [reader, setReader] = useState(false)
  // Desktop: lock (click-through) so you can work in other apps with Reader
  // floating on top. Unlock is native-only (Cmd/Ctrl+Shift+L or tray) — a
  // click-through window can't be clicked.
  const lockMode = useLockMode()
  const panel = usePanelWidth() // shared width so the transcript reflows beside the panel
  const [followSource, setFollowSource] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const providerRef = useRef<TranscriptionProvider | null>(null)
  const mutedRef = useRef(false)
  useEffect(() => {
    mutedRef.current = muted
  }, [muted])

  // Local per-device overrides (custom name + color) keyed by sender clientId.
  const overrides: SpeakerOverrides = prefs

  // Follow-along source = the LATEST turn (grows live as that speaker talks);
  // context = the couple of turns before it, so the reader keeps the thread.
  // Grouped by sender so a multi-line turn stays one block.
  const follow = useMemo(() => {
    const turns: string[] = []
    let lastSender: string | undefined
    let cur = ''
    for (const s of segments) {
      if (!s.text.trim()) continue
      if (s.sender !== lastSender && cur) {
        turns.push(cur)
        cur = ''
      }
      cur = cur ? `${cur} ${s.text}` : s.text
      lastSender = s.sender
    }
    if (cur) turns.push(cur)
    const source = turns.length ? turns[turns.length - 1] : transcriptText(segments)
    const context = turns.slice(Math.max(0, turns.length - 3), turns.length - 1).join('  ')
    return { source, context }
  }, [segments])

  // See peers' words the moment they speak — before starting my own mic.
  useEffect(() => {
    onPeer((m) => setSegments((s) => mergeRoomSegments(s, m)))
  }, [onPeer])

  const full = mySlot < 0 // past the 5-speaker cap → listen-only

  const onStart = useCallback(async () => {
    if (starting || live) return // ignore re-entry during the connect window
    setStarting(true)
    setStartError(null)
    try {
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
      // Desktop + System source: native OS tap first. 0 = not native; a real
      // native failure REJECTS — catch it so we fall back to the browser path
      // instead of hard-failing onStart.
      let nativeRate = 0
      if (source === 'system') {
        try {
          nativeRate = await native.start(onPcm, setLevel, { isMuted: () => mutedRef.current })
        } catch (err) {
          logError('room/native.start', err)
          if (native.isNative) {
            // Desktop: getDisplayMedia doesn't work in the shell webview, so a
            // browser fallback would show a share picker that captures nothing.
            // Fail with the actionable fix instead.
            throw new Error(
              'System-audio capture was blocked by macOS. Open System Settings → Privacy & Security → Screen & System Audio Recording, enable LiveTranscript, then quit and reopen the app.',
            )
          }
          // Browser: fall through to the getDisplayMedia share picker below.
        }
      }
      const rate =
        nativeRate ||
        (await start(onPcm, setLevel, { source, isMuted: () => mutedRef.current }))
      const res = await connectWithFallback({ keyterms, sampleRate: rate, maxSpeakers: 1 })
      provider = res.provider
      providerRef.current = provider
      for (const chunk of pending) provider.sendAudio(chunk) // flush pre-connect audio
      pending.length = 0
      const relay = (e: Parameters<typeof publish>[0]) => {
        setSegments((s) =>
          mergeRoomSegments(s, { ...e, speaker: mySlot, sender: myClientId, name: displayName }),
        )
        publish(e)
      }
      provider.onPartial(relay)
      provider.onFinal(relay)
      // Socket dropped after connect: surface it and stop the "live" illusion
      // (kill the meter, flip live off) — no silent dead session.
      provider.onStatus?.(({ error }) => {
        stop()
        void native.stop()
        setLive(false)
        setLevel(0)
        setStartError(error)
      })
      setLive(true)
    } catch (e) {
      stop()
      void native.stop() // native tap may have started before connect threw — don't leak it
      setStartError(e instanceof Error ? e.message : 'Failed to start')
    } finally {
      setStarting(false)
    }
  }, [start, stop, native, publish, mySlot, myClientId, displayName, source, keyterms, starting, live])

  const onStop = useCallback(async () => {
    stop()
    void native.stop() // tear down the native tap too (no-op in the browser)
    await providerRef.current?.disconnect()
    setLive(false)
    setLevel(0)
  }, [stop, native])

  // Ending broadcasts to everyone, then leaves. Peers receive 'end' and leave too.
  const onEnd = useCallback(async () => {
    endMeeting()
    await onStop()
    router.push('/dashboard')
  }, [endMeeting, onStop, router])

  // Reflect my audio state in presence so the roster shows mic / system /
  // listening for everyone. Listen-only (over the 5-cap) always reads "listening".
  useEffect(() => {
    setPresenceSource(full ? 'listening' : live ? source : 'listening')
  }, [full, live, source, setPresenceSource])

  // If someone else ends the meeting, stop + leave gracefully.
  useEffect(() => {
    onRoomEnd(() => {
      void onStop()
      router.push('/dashboard')
    })
  }, [onRoomEnd, onStop, router])

  // Copy the whole meeting transcript to the clipboard (Mod+C, no active selection).
  const onCopyTranscript = useCallback(async () => {
    const text = transcriptText(segments)
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
    } catch (err) {
      logError('room/copyTranscript', err)
    }
  }, [segments])

  // Keyboard shortcuts. S start/stop, Space/M mute (live), Mod+C copy transcript.
  // NOTE: Esc no longer ends the meeting — ending is destructive (kicks all peers),
  // so a stray Esc shouldn't kill a live room. Ending stays on the explicit button
  // + S. This also matches /record, where Esc only closes overlays. "?" help sheet
  // owns Esc when open (ShortcutHelp, capture phase).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      const mod = e.metaKey || e.ctrlKey
      const k = e.key.toLowerCase()

      // Handle mod-combos here, then RETURN — so Cmd/Ctrl+S (save), Cmd+M
      // (minimize), etc. never fall through to the plain-key S/M branches below
      // and silently start/stop the mic or toggle mute.
      if (mod) {
        if (!typing && k === 'c' && (window.getSelection()?.toString() ?? '') === '') {
          e.preventDefault()
          void onCopyTranscript()
        }
        return
      }
      if (typing) return
      // Esc exits Reader (only when it's open) — matches /record; doesn't end the meeting.
      if (e.key === 'Escape' && reader) {
        e.preventDefault()
        setReader(false)
        return
      }
      // R toggles Reader mode (like /record).
      if (k === 'r') {
        e.preventDefault()
        setReader((v) => !v)
        return
      }
      if (k === 's' && !starting) {
        e.preventDefault()
        void (live ? onStop() : onStart())
      }
      if (live && (e.key === ' ' || k === 'm')) {
        e.preventDefault()
        setMuted((m) => !m)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [live, starting, onStart, onStop, onCopyTranscript, reader])

  const me = speakerColor(mySlot < 0 ? 0 : mySlot, themeMode.theme)

  return (
    // Lock the meeting to ONE viewport: header fixed, transcript is the only
    // scroll region — otherwise the page AND the transcript both scroll ("two scrolls").
    <main
      // Ask panel open on desktop → reserve its width as right-padding so the
      // meeting header/transcript reflow beside it (not under it). Mobile: sheet.
      className="relative flex h-dvh flex-col overflow-hidden bg-[color:var(--paper)] text-[color:var(--ink)] sm:pr-[var(--ask-w,0px)] sm:transition-[padding] sm:duration-200"
      style={askOpen ? ({ '--ask-w': `${panel.width}px` } as React.CSSProperties) : undefined}
    >
      <ShortcutHelp
        shortcuts={[
          { keys: 'S', label: live ? 'Stop' : 'Start' },
          { keys: 'Space / M', label: 'Mute / unmute (while live)' },
          { keys: `${MOD}C`, label: 'Copy transcript' },
          { keys: `${MOD}⇧H`, label: 'Hide / show window (desktop)' },
          { keys: `${MOD}⇧L`, label: 'Lock / release click-through (desktop)' },
          { keys: `${MOD}⇧↑/↓`, label: 'Scroll transcript while locked (desktop)' },
        ]}
      />
      {/* Reader mode: hide ALL chrome, float Exit + (desktop) Lock controls (matches /record). */}
      {reader && (
        <div className="fixed right-4 top-4 z-50 flex items-center gap-2">
          {/* Lock (click-through): Apple-style switch. Turning it ON makes the whole
              window pass clicks through, so the switch itself becomes unclickable —
              release is the GLOBAL hotkey Cmd/Ctrl+Shift+L (or the tray). The (i)
              tooltip carries that warning. Desktop only. */}
          {lockMode.available && (
            <div className="glass flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm">
              <Lock size={14} className={lockMode.locked ? 'text-emerald-600' : 'text-black/50'} />
              <LeverSwitch
                checked={lockMode.locked}
                onChange={(on) => { if (on) void lockMode.enable() }}
                label="Lock (click-through)"
              />
              {/* Real popover — native title tooltips don't render in the Tauri
                  WebView. CSS-only: shows on hover or keyboard focus. */}
              <span className="group relative flex" tabIndex={0} aria-label={`Lock makes the window click-through. Release with ${MOD}⇧L.`}>
                <Info size={14} className="cursor-help text-black/40" />
                <span
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-full z-50 mt-2 hidden w-60 rounded-xl border border-black/10 bg-white px-3 py-2 text-xs leading-relaxed text-black/70 shadow-xl group-focus-within:block group-hover:block"
                >
                  Lock makes this window click-through so you can work in apps behind it.
                  Scroll with <kbd className="rounded bg-black/[0.07] px-1 font-sans">{MOD}⇧↑/↓</kbd>, release
                  with <kbd className="rounded bg-black/[0.07] px-1 font-sans">{MOD}⇧L</kbd> — both work while locked.
                </span>
              </span>
            </div>
          )}
          {/* Reader hides the header, so mirror the theme toggle here — this is the
              surface people read for the longest stretch. */}
          {!lockMode.locked && <ThemeToggle className="glass" />}
          {!lockMode.locked && (
            <button
              onClick={() => setReader(false)}
              className="glass flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm"
              title="Exit Reader (Esc)"
            >
              <BookOpen size={15} /> Exit Reader
            </button>
          )}
        </div>
      )}

      {/* Collapsed: a slim bar giving the transcript the full viewport. Keeps only
          the expand toggle + Ask + End (the always-needed controls). */}
      {!reader && headerCollapsed && (
        <div className="flex items-center gap-2 px-4 py-1.5 sm:px-6">
          <button
            onClick={() => setHeaderCollapsed(false)}
            className="glass glass-interactive flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-black/55"
            title="Show meeting controls"
            aria-expanded={false}
          >
            <ChevronDown size={14} /> Controls
          </button>
          <span className={`text-xs ${connected ? 'text-emerald-700' : 'text-black/40'}`}>{connected ? 'Connected' : 'Connecting…'}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setAskOpen((v) => !v)}
              data-active={askOpen}
              aria-pressed={askOpen}
              className="glass glass-interactive flex min-h-8 items-center gap-1.5 rounded-lg px-3 text-xs text-black/60 data-[active=true]:text-[color:var(--signal)]"
              title="Ask the transcript"
            >
              <Sparkles size={13} /> Ask
            </button>
            <button onClick={onEnd} className="btn-stop min-h-8 px-3 text-xs" title="End meeting for everyone">
              End
            </button>
          </div>
        </div>
      )}

      {/* Top bar: home nav + identity + copyable meeting id + status, End on the right. */}
      <header className={`${headerCollapsed || reader ? 'hidden' : 'flex'} shrink-0 flex-wrap items-center gap-2 border-b border-[color:var(--line)] bg-[color:var(--reader)] px-4 py-3 sm:gap-3 sm:px-6 sm:py-4`}>
        <button
          onClick={() => setHeaderCollapsed(true)}
          className="glass glass-interactive flex min-h-11 w-11 items-center justify-center rounded-lg text-black/50"
          title="Collapse controls — give the transcript the full screen"
          aria-expanded={true}
        >
          <ChevronUp size={16} />
        </button>
        <HomeMenu />
        {!full && (
          <span className="flex items-center gap-1.5 text-sm">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: me.color }} />
            {displayName ?? `You’re ${me.name}`}
          </span>
        )}
        <CopyMeetingId roomId={roomId} />
        <button
          onClick={() => setShowRoster((v) => !v)}
          data-active={showRoster}
          aria-expanded={showRoster}
          className="glass glass-interactive flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-black/60 data-[active=true]:text-ink"
          title="Who's in the meeting"
        >
          <Users size={14} />
          {roster.length}
          {roster.length > MAX_SPEAKERS ? ` (${MAX_SPEAKERS} speaking)` : ''}
        </button>
        <span className={`text-sm ${connected ? 'text-emerald-700' : 'text-black/40'}`} title={connected ? 'Connected' : 'Connecting…'}>
          <span>{connected ? 'Connected' : 'Connecting…'}</span>
        </span>
        <div className="flex w-full flex-wrap items-center gap-2 border-t border-[color:var(--line)] pt-3 xl:ml-auto xl:w-auto xl:border-0 xl:pt-0">
          <TextSizeControl
            onDec={textScale.dec}
            onInc={textScale.inc}
            canDec={textScale.canDec}
            canInc={textScale.canInc}
          />

          <ThemeToggle label className="glass glass-interactive" />
          {/* Reader mode: distraction-free full-viewport transcript (like /record). */}
          <button
            onClick={() => setReader((v) => !v)}
            data-active={reader}
            className="glass glass-interactive flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-black/55 data-[active=true]:text-[color:var(--signal)]"
            title="Reader mode — full-screen transcript"
          >
            <BookOpen size={15} /> Reader
          </button>
          <div className="glass flex items-center rounded-lg p-0.5 text-sm">
            <button
              onClick={() => setView('transcript')}
              data-active={view === 'transcript'}
              aria-pressed={view === 'transcript'}
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-black/50 data-[active=true]:bg-ink data-[active=true]:text-white"
            >
              Transcript
            </button>
            <button
              onClick={() => setView('chat')}
              data-active={view === 'chat'}
              aria-pressed={view === 'chat'}
              className="inline-flex min-h-10 items-center rounded-lg px-3 text-black/50 data-[active=true]:bg-ink data-[active=true]:text-white"
            >
              Chat
            </button>
          </div>
          <button
            onClick={() => setAskOpen((v) => !v)}
            data-active={askOpen}
              aria-pressed={askOpen}
            className="glass glass-interactive flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm text-black/60 data-[active=true]:text-[color:var(--signal)]"
            title="Ask the transcript"
          >
            <Sparkles size={15} /> Ask
          </button>
          <button onClick={onEnd} className="btn-stop" title="End meeting for everyone">
            End
          </button>
        </div>
      </header>

      {(startError || error || roomError) && (
        <p role="alert" className="border-b border-[color:var(--line)] bg-[color:var(--reader)] px-6 py-3 text-sm text-[color:var(--stop)]">{startError ?? error ?? roomError}</p>
      )}

      {showRoster && (
        <RosterPanel
          members={members}
          myClientId={myClientId}
          prefs={prefs}
          setPref={setPref}
          onClose={() => setShowRoster(false)}
        />
      )}

      {/* Follow-along overlay: repeat the live turn aloud, guided word-by-word,
          with the previous turns shown above as context. Reads `follow` live so
          the passage keeps growing while it's open. */}
      {followSource && (
        <FollowAlong
          source={follow.source}
          context={follow.context}
          keyterms={keyterms}
          onClose={() => setFollowSource(null)}
        />
      )}

      {/* The transcript owns the ONLY scrollbar. `fill` makes it grow to the
          remaining viewport (flex-1) instead of a fixed 100dvh cap, so it fits
          under the header + above the dock without a second page scrollbar. */}
      <div className="min-h-0 flex-1">
        {segments.length === 0 && !reader ? <div className="flex h-full flex-col items-center justify-center px-6 pb-40 pt-10 text-center"><span className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] text-[color:var(--signal)]"><AudioLines size={23} aria-hidden /></span><h1 className="text-2xl font-semibold tracking-tight">{live ? 'Listening for the conversation' : 'Your shared transcript starts here'}</h1><p role="status" className="mt-3 max-w-md text-sm leading-6 text-[color:var(--muted)]">{live ? 'Speak naturally. Finalized words will appear here with each speaker identified.' : full ? 'All speaker slots are in use. The conversation will appear here as participants transcribe.' : 'Choose an audio source below, then start transcription. Other participants’ words will appear here too.'}</p></div> : view === 'chat' ? (
          <ChatView segments={segments} fill overrides={overrides} scale={textScale.scale} />
        ) : (
          <TranscriptView segments={segments} readerMode={reader} autoScroll fade={!reader} fill overrides={overrides} scale={textScale.scale} />
        )}
      </div>

      {/* Bottom-center control dock: follow-along, source, mic mute, start/stop.
          Wraps + caps width so it never overflows a phone; rounded-3xl so a
          wrapped multi-row dock still looks intentional.
          Hidden in Reader mode — reading surface only, no chrome. */}
      <div className={`${reader ? 'hidden' : 'flex'} pointer-events-none fixed inset-x-0 bottom-6 z-40 justify-center sm:right-[var(--ask-w,0px)] px-3`}>
        <div className="glass pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-xl px-4 py-2.5 sm:gap-3">
          {/* Follow along — repeat the latest line aloud, guided word-by-word.
              Available to everyone (a listener repeating the speaker is the point). */}
          <button
            onClick={() => follow.source && setFollowSource(follow.source)}
            disabled={!follow.source}
            className="btn-ghost flex items-center gap-2 text-sm disabled:opacity-40"
            title="Follow along — repeat the conversation, guided as you read"
          >
            <BookOpen size={16} /> Follow
          </button>
          {!full && <span className="hidden h-5 w-px bg-black/10 sm:block" aria-hidden />}
          {full ? (
            <span className="px-3 text-sm text-black/60">Speaker slots full — reading only</span>
          ) : (
            <>
              {!live && (
                <Select
                  ariaLabel="Audio source"
                  value={source}
                  onChange={(v) => setSource(v)}
                  title="Choose call or browser audio, or use your microphone for the room."
                  options={[
                    { value: 'system', label: 'System sound (recommended)' },
                    { value: 'mic', label: 'Microphone' },
                  ]}
                />
              )}
              {live && (
                <div className="flex items-center gap-2 text-sm text-black/60" title="Mute / unmute (M or Space)">
                  {muted ? <MicOff size={16} /> : <Mic size={16} />}
                  <span className="hidden sm:inline">{muted ? 'Muted' : 'Audio on'}</span>
                  <LeverSwitch checked={muted} onChange={setMuted} label="Mute captured audio" />
                </div>
              )}
              <Waveform level={level} active={live && !muted} />
              {!live ? (
                <button onClick={onStart} disabled={starting} className="btn-signal disabled:opacity-50" title="Start (S)">
                  {starting ? 'Starting…' : 'Start transcription'}
                </button>
              ) : (
                <button onClick={onStop} className="btn-stop flex items-center gap-2" title="Stop (S)">
                  <span className="live-dot" aria-hidden />
                  Stop
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Copilot drawer — grounded in the meeting transcript. Full-width sheet on
          phones, ~24rem column on desktop. */}
      {askOpen && (
        <>
          <div className="fixed inset-0 z-50 bg-black/10 sm:hidden" onClick={() => setAskOpen(false)} aria-hidden />
          <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-auto">
            <CopilotPanel
              getTranscript={() => transcriptText(segments)}
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
