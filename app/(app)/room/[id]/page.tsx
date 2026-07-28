'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, BookOpen, Check, ChevronDown, ChevronUp, Copy, Info, Lock, Mic, MicOff, Sparkles, Users } from 'lucide-react'
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
import { Waveform } from '@/components/transcript/Waveform'
import { Select } from '@/components/ui/Select'
import { ShortcutHelp, MOD } from '@/components/ui/ShortcutHelp'
import { RosterPanel } from '@/components/room/RosterPanel'
import { FollowAlong } from '@/components/room/FollowAlong'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { useLockMode } from '@/lib/desktop/useLockMode'
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
  const [joined, setJoined] = useState(false)

  // "/room/new" → mint a unique meeting id and redirect, so each meeting is its own channel.
  useEffect(() => {
    if (id === 'new') router.replace(`/room/${newRoomId()}`)
  }, [id, router])

  // On id change: if arriving with ?join=1 (Go = open, not just update), go
  // straight into the meeting; otherwise drop to that meeting's lobby rather than
  // showing the previous room's live view.
  useEffect(() => {
    setJoined(autoJoin)
  }, [id, autoJoin])

  if (id === 'new') {
    return (
      <main className="mx-auto max-w-md px-6 py-24 text-center text-black/50">
        Creating your meeting…
      </main>
    )
  }

  // Reject guessable / enumerable ids — real meetings arrive via a shared random link.
  if (!isStrongRoomId(id)) return <InvalidRoom />

  if (!joined) return <Lobby roomId={id} onJoin={() => setJoined(true)} />
  return <Meeting roomId={id} />
}

function InvalidRoom() {
  return (
    <main className="mx-auto max-w-md px-6 py-24 text-center">
      <h1 className="font-[family-name:var(--font-serif)] text-3xl">That meeting link isn&rsquo;t valid</h1>
      <p className="mt-3 text-black/60">
        Meeting links are randomly generated. Ask the host to resend their invite, or start a new
        meeting of your own.
      </p>
      <a href="/room/new" className="btn-signal mt-6 inline-block px-6 py-3">
        Start a new meeting
      </a>
    </main>
  )
}

function Lobby({ roomId, onJoin }: { roomId: string; onJoin: () => void }) {
  const router = useRouter()
  const [copied, setCopied] = useState(false)
  const [idCopied, setIdCopied] = useState(false)
  const [joinId, setJoinId] = useState('')

  // Build the invite from the origin + THIS room id (not window.location.href,
  // which can still read "/room/new" right after the redirect). Set after mount
  // so SSR doesn't bake in an empty origin that hydration then freezes.
  const [link, setLink] = useState('')
  useEffect(() => {
    setLink(`${window.location.origin}/room/${roomId}`)
  }, [roomId])
  const copyInvite = () => {
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  const mailto =
    `mailto:?subject=${encodeURIComponent('Join my LiveTranscript meeting')}` +
    `&body=${encodeURIComponent(`Join the live transcript meeting:\n${link}\n\nMeeting ID: ${roomId}`)}`

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      {/* Back out of the lobby without joining — otherwise the join screen is a
          dead end (no nav chrome here). Prefer real history back; fall to dashboard. */}
      <button
        onClick={() => (window.history.length > 1 ? router.back() : router.push('/dashboard'))}
        className="mb-6 flex items-center gap-1.5 text-sm text-black/50 transition-colors hover:text-ink"
      >
        <ArrowLeft size={16} /> Back
      </button>
      <p className="text-sm font-medium uppercase tracking-widest text-emerald-700">Live meeting</p>
      <h1 className="mt-2 font-[family-name:var(--font-serif)] text-3xl leading-tight sm:text-4xl">
        You&rsquo;re about to join
      </h1>
      <div className="glass mt-6 rounded-2xl p-5">
        <div className="text-xs uppercase tracking-wide text-black/40">Meeting ID</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="min-w-0 select-all truncate font-mono text-lg">{roomId}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(roomId)
              setIdCopied(true)
              setTimeout(() => setIdCopied(false), 2000)
            }}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-black/5 text-black/50 transition-colors hover:bg-black/10 hover:text-ink"
            title="Copy meeting ID"
            aria-label="Copy meeting ID"
          >
            {idCopied ? <Check size={14} className="text-emerald-700" /> : <Copy size={14} />}
          </button>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-black/60">
          Up to {MAX_SPEAKERS} people can speak — each on their own device. Get everyone on a
          separate voice call for audio; LiveTranscript syncs the text live and colors each speaker.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <button onClick={copyInvite} className="btn-ghost text-sm">
            {copied ? 'Link copied ✓' : 'Copy invite link'}
          </button>
          <a href={mailto} className="btn-ghost text-sm">
            Invite by email
          </a>
        </div>
      </div>

      <button onClick={onJoin} className="btn-signal mt-6 w-full py-3 text-base">
        Join meeting
      </button>

      <form
        className="mt-8 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          // Accept a full pasted link, a link with query/hash, or a bare id. Strip
          // any query/hash, then take the last path segment.
          const raw = (joinId.trim().split(/[?#]/)[0].split('/').filter(Boolean).pop() ?? '')
          const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '')
          if (!clean) return
          // Pasting the link for THIS room = just join it (don't no-op).
          if (clean === roomId) return onJoin()
          // ?join=1 tells the target room to OPEN straight into the meeting
          // instead of stopping at its lobby (Go = open, not just update).
          router.push(`/room/${clean}?join=1`)
        }}
      >
        <label htmlFor="join-id" className="sr-only">
          Join a different meeting ID
        </label>
        <input
          id="join-id"
          name="joinId"
          value={joinId}
          onChange={(e) => setJoinId(e.target.value)}
          placeholder="Join a different meeting ID"
          className="min-w-0 flex-1 rounded-full border border-black/15 bg-white/60 px-4 py-2 text-sm outline-none focus:border-emerald-700"
        />
        <button type="submit" className="btn-ghost text-sm">
          Go
        </button>
      </form>
    </main>
  )
}

// The meeting id as a one-tap copyable chip — copies the full join link so it's
// trivial to paste to whoever should join. Friendly ids read aloud fine too.
function CopyMeetingId({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    const link = typeof window !== 'undefined' ? `${window.location.origin}/room/${roomId}` : roomId
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className="glass glass-interactive flex items-center gap-2 rounded-full py-1 pl-3 pr-2 text-sm"
      title="Copy the join link"
    >
      <span className="font-mono text-black/70">{roomId}</span>
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-black/5 text-black/50">
        {copied ? <Check size={13} className="text-emerald-700" /> : <Copy size={13} />}
      </span>
    </button>
  )
}

function Meeting({ roomId }: { roomId: string }) {
  const router = useRouter()
  const displayName = useDisplayName()
  const { keyterms } = useKeytermPrefs()
  const textScale = useTextScale() // reader text-size preference (localStorage)
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
  const [view, setView] = useState<'transcript' | 'chat'>('transcript')
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
  // Paced auto-scroll speed (px/sec). 0 = jump-follow the live edge (default).
  // Stepped presets so the control is one tap, not a fiddly slider.
  const SCROLL_SPEEDS = [0, 20, 40, 70] as const
  const [speedIdx, setSpeedIdx] = useState(0)
  const panel = usePanelWidth() // shared width so the transcript reflows beside the panel
  const [followSource, setFollowSource] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)
  const providerRef = useRef<TranscriptionProvider | null>(null)
  const mutedRef = useRef(false)
  mutedRef.current = muted

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
          logError('room/native.start', err) // native tap failed — fall back to browser
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

  const me = speakerColor(mySlot < 0 ? 0 : mySlot, 'light')

  return (
    // Lock the meeting to ONE viewport: header fixed, transcript is the only
    // scroll region — otherwise the page AND the transcript both scroll ("two scrolls").
    <main
      // Ask panel open on desktop → reserve its width as right-padding so the
      // meeting header/transcript reflow beside it (not under it). Mobile: sheet.
      className="relative flex h-dvh flex-col overflow-hidden bg-[#faf9f7] text-[#16151a] sm:pr-[var(--ask-w,0px)] sm:transition-[padding] sm:duration-200"
      style={askOpen ? ({ '--ask-w': `${panel.width}px` } as React.CSSProperties) : undefined}
    >
      <ShortcutHelp
        shortcuts={[
          { keys: 'S', label: live ? 'Stop' : 'Start' },
          { keys: 'Space / M', label: 'Mute / unmute (while live)' },
          { keys: `${MOD}C`, label: 'Copy transcript' },
          { keys: `${MOD}⇧H`, label: 'Hide / show window (desktop)' },
          { keys: `${MOD}⇧L`, label: 'Lock / release click-through (desktop)' },
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
            <div className="glass flex items-center gap-2 rounded-full px-3 py-1.5 text-sm">
              <Lock size={14} className={lockMode.locked ? 'text-emerald-600' : 'text-black/50'} />
              <button
                role="switch"
                aria-checked={lockMode.locked}
                aria-label="Lock (click-through)"
                onClick={() => { if (!lockMode.locked) void lockMode.enable() }}
                className={`relative h-5 w-9 rounded-full transition-colors duration-200 ${lockMode.locked ? 'bg-emerald-500' : 'bg-black/20'}`}
              >
                <span
                  className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200 ${lockMode.locked ? 'translate-x-[18px]' : 'translate-x-0.5'}`}
                />
              </button>
              {/* ponytail: native title tooltip — custom popover only if styling ever matters */}
              <span
                title={`Lock makes this window click-through so you can work in apps behind it. Release with ${MOD}⇧L (works even while locked).`}
                aria-label={`Lock makes the window click-through. Release with ${MOD}⇧L.`}
                className="flex cursor-help text-black/40"
              >
                <Info size={14} />
              </span>
            </div>
          )}
          {!lockMode.locked && (
            <button
              onClick={() => setReader(false)}
              className="glass flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
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
            className="glass glass-interactive flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs text-black/55"
            title="Show meeting controls"
            aria-expanded={false}
          >
            <ChevronDown size={14} /> Controls
          </button>
          <span className={`text-xs ${connected ? 'text-emerald-700' : 'text-black/40'}`}>{connected ? '●' : '○'}</span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setAskOpen((v) => !v)}
              data-active={askOpen}
              className="glass glass-interactive flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs text-black/60 data-[active=true]:text-emerald-800"
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
      <header className={`${headerCollapsed || reader ? 'hidden' : 'flex'} flex-wrap items-center gap-2 px-4 py-3 sm:gap-3 sm:px-6 sm:py-4`}>
        <button
          onClick={() => setHeaderCollapsed(true)}
          className="glass glass-interactive flex min-h-11 w-11 items-center justify-center rounded-full text-black/50"
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
          className="glass glass-interactive flex min-h-11 items-center gap-1.5 rounded-full px-3 text-sm text-black/60 data-[active=true]:text-ink"
          title="Who's in the meeting"
        >
          <Users size={14} />
          {roster.length}
          {roster.length > MAX_SPEAKERS ? ` (${MAX_SPEAKERS} speaking)` : ''}
        </button>
        <span className={`text-sm ${connected ? 'text-emerald-700' : 'text-black/40'}`} title={connected ? 'Connected' : 'Connecting…'}>
          {/* Phone: dot only (saves the crowded header). Desktop: dot + label. */}
          <span className="sm:hidden">{connected ? '●' : '○'}</span>
          <span className="hidden sm:inline">{connected ? '● connected' : '○ connecting…'}</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <TextSizeControl
            onDec={textScale.dec}
            onInc={textScale.inc}
            canDec={textScale.canDec}
            canInc={textScale.canInc}
          />
          {/* Paced auto-scroll speed: Off → Slow → Med → Fast. One tap cycles it.
              Off = follow the live edge; the rest creep hands-free at set px/sec. */}
          <button
            onClick={() => setSpeedIdx((i) => (i + 1) % SCROLL_SPEEDS.length)}
            data-active={speedIdx > 0}
            className="glass glass-interactive flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm text-black/55 data-[active=true]:text-emerald-800"
            title="Auto-scroll speed (Off / Slow / Medium / Fast)"
          >
            ⇅ {['Off', 'Slow', 'Med', 'Fast'][speedIdx]}
          </button>
          {/* Reader mode: distraction-free full-viewport transcript (like /record). */}
          <button
            onClick={() => setReader((v) => !v)}
            data-active={reader}
            className="glass glass-interactive flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm text-black/55 data-[active=true]:text-emerald-800"
            title="Reader mode — full-screen transcript"
          >
            <BookOpen size={15} /> Reader
          </button>
          <div className="glass flex items-center rounded-full p-0.5 text-sm">
            <button
              onClick={() => setView('transcript')}
              data-active={view === 'transcript'}
              className="inline-flex min-h-10 items-center rounded-full px-3 text-black/50 data-[active=true]:bg-ink data-[active=true]:text-white"
            >
              Transcript
            </button>
            <button
              onClick={() => setView('chat')}
              data-active={view === 'chat'}
              className="inline-flex min-h-10 items-center rounded-full px-3 text-black/50 data-[active=true]:bg-ink data-[active=true]:text-white"
            >
              Chat
            </button>
          </div>
          <button
            onClick={() => setAskOpen((v) => !v)}
            data-active={askOpen}
            className="glass glass-interactive flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm text-black/60 data-[active=true]:text-emerald-800"
            title="Ask the transcript"
          >
            <Sparkles size={15} /> Ask
          </button>
          <button onClick={onEnd} className="btn-stop" title="End meeting for everyone (Esc)">
            End
          </button>
        </div>
      </header>

      {(startError || error || roomError) && (
        <p className="px-6 text-sm text-red-700">{startError ?? error ?? roomError}</p>
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
        {view === 'chat' ? (
          <ChatView segments={segments} theme="light" fill overrides={overrides} scale={textScale.scale} />
        ) : (
          <TranscriptView segments={segments} theme="light" readerMode={reader} autoScroll fade={!reader} fill overrides={overrides} scale={textScale.scale} scrollSpeed={SCROLL_SPEEDS[speedIdx]} />
        )}
      </div>

      {/* Bottom-center control dock: follow-along, source, mic mute, start/stop.
          Wraps + caps width so it never overflows a phone; rounded-3xl so a
          wrapped multi-row dock still looks intentional.
          Hidden in Reader mode — reading surface only, no chrome. */}
      <div className={`${reader ? 'hidden' : 'flex'} pointer-events-none fixed inset-x-0 bottom-6 z-40 justify-center sm:right-[var(--ask-w,0px)] px-3`}>
        <div className="glass pointer-events-auto flex max-w-[calc(100vw-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-3xl px-4 py-2.5 sm:gap-3">
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
            <span className="px-3 text-sm text-black/60">Meeting full — you’re listening</span>
          ) : (
            <>
              {!live && (
                <Select
                  ariaLabel="Audio source"
                  value={source}
                  onChange={(v) => setSource(v)}
                  title="System sound is a digital loopback — no echo, no conflict with Zoom/Meet. Microphone is for the physical room only."
                  options={[
                    { value: 'system', label: 'System sound (recommended)' },
                    { value: 'mic', label: 'Microphone' },
                  ]}
                />
              )}
              {live && (
                <button
                  onClick={() => setMuted((m) => !m)}
                  data-active={muted}
                  className="btn-ghost flex items-center gap-2 text-sm"
                  title="Mute / unmute (M or Space)"
                >
                  {muted ? <MicOff size={16} /> : <Mic size={16} />}
                  <span className="hidden sm:inline">{muted ? 'Muted' : 'Mic on'}</span>
                </button>
              )}
              <Waveform level={level} active={live && !muted} />
              {!live ? (
                <button onClick={onStart} disabled={starting} className="btn-signal disabled:opacity-50" title="Start (S)">
                  {starting ? 'Starting…' : 'Start speaking'}
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
