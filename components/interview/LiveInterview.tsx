'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronRight, Download, Mic, Settings2, Sparkles, Square, Waves } from 'lucide-react'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { usePanelWidth } from '@/lib/copilot/usePanelWidth'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import { liveTranscript, useInterviewRecorder } from '@/lib/interview/useInterviewRecorder'
import { downloadInterview } from '@/lib/interview/client'
import { useInterviewTuning } from '@/lib/interview/TuningContext'
import type { InterviewSession } from '@/lib/interview/session'

export function LiveInterview({ visible, blocked, onActivity, onComplete }: {
  visible: boolean; blocked: boolean; onActivity: (active: boolean) => void
  onComplete: (session: InterviewSession) => void
}) {
  const call = useInterviewRecorder()
  const microphone = useInterviewRecorder()
  const tuning = useInterviewTuning()
  const { keyterms } = useKeytermPrefs()
  const panel = usePanelWidth()
  const [source, setSource] = useState<'both' | 'system' | 'mic'>('both')
  const [title, setTitle] = useState('Live interview')
  const [consent, setConsent] = useState(false)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [captureStartedAt, setCaptureStartedAt] = useState(0)
  const startTime = useRef(0)
  const ending = useRef(false)
  const sessionId = useRef('')
  const activity = useRef(false)
  const getCallSegments = call.getSegments
  const getMicSegments = microphone.getSegments
  const text = useCallback(() => liveTranscript(
    source === 'mic' ? [] : getCallSegments().filter((row) => row.capturedAt >= startTime.current),
    source === 'system' ? [] : getMicSegments().filter((row) => row.capturedAt >= startTime.current),
  ), [getCallSegments, getMicSegments, source])

  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])

  async function begin() {
    if (activity.current || blocked || !consent) return
    activity.current = true; ending.current = false; sessionId.current = crypto.randomUUID(); startTime.current = Date.now()
    setCaptureStartedAt(startTime.current); setElapsed(0); setError(null); setBusy(true); setActive(true); setTranscriptOpen(false); onActivity(true)
    try {
      if (source !== 'mic') await call.start('system', keyterms)
      if (!ending.current && source !== 'system') await microphone.start('mic', keyterms)
      if (!ending.current) setAskOpen(true)
    } catch (e) {
      await Promise.all([call.stop(), microphone.stop()])
      if (!ending.current) setError(e instanceof Error ? e.message : 'Could not start audio capture.')
    } finally { if (!ending.current) setBusy(false) }
  }

  async function finish() {
    if (ending.current || !activity.current) return
    ending.current = true; setFinishing(true); setBusy(true); setAskOpen(false)
    try {
      const [callRows, micRows] = await Promise.all([call.stop(), microphone.stop()])
      const transcript = liveTranscript(
        source === 'mic' ? [] : callRows.filter((row) => row.capturedAt >= startTime.current),
        source === 'system' ? [] : micRows.filter((row) => row.capturedAt >= startTime.current),
      )
      if (!transcript.trim()) { setError('No speech was captured. Check the selected audio source and start again.'); return }
      onComplete({
        id: sessionId.current, kind: 'live', title: title.trim() || 'Live interview',
        createdAt: startTime.current, durationSeconds: Math.max(0, Math.round((Date.now() - startTime.current) / 1000)), transcript, turns: [],
        captureNote: source === 'both'
          ? 'Separate call/system audio and candidate microphone channels. Speaker numbers in the call channel do not identify the candidate. Microphone is presumed candidate; nearby voices/echo can be present. Arrival order is approximate, not synchronized word timing. AI/copilot suggestions are not included.'
          : source === 'system'
            ? 'System/call audio only. The candidate microphone was NOT captured separately; candidate answers may be missing. Do not infer candidate identity from speaker numbers. AI/copilot suggestions are not included.'
            : 'Microphone only, presumed to be the candidate. Interviewer questions may be missing. Nearby voices may also be present. AI/copilot suggestions are not included.',
      })
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not finish the interview. Export the transcript before leaving.') }
    finally { activity.current = false; ending.current = false; setFinishing(false); setActive(false); setBusy(false); onActivity(false) }
  }

  const callRows = call.segments.filter((row) => row.capturedAt >= captureStartedAt)
  const micRows = microphone.segments.filter((row) => row.capturedAt >= captureStartedAt)
  const captured = (source !== 'mic' && callRows.length > 0) || (source !== 'system' && micRows.length > 0)
  const hasRecording = call.phase === 'recording' || microphone.phase === 'recording'
  const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  // The generic copilot default is intentionally narrow for transcript pages.
  // Live Interview is answer-first: reserve enough width for readable technical
  // answers even when an older 384px preference is stored in localStorage.
  const livePanelWidth = Math.min(780, Math.max(600, panel.width))

  if (!active) return <div className="mx-auto max-w-2xl py-5 sm:py-12">
    <section className="rounded-2xl border border-black/[0.07] bg-white/60 px-5 py-8 text-center sm:px-10 sm:py-12">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-800"><Waves size={20} /></div>
      <h2 className="mt-5 text-2xl font-semibold tracking-[-0.025em]">Ready when the interview starts</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-black/45">Live keeps setup out of the way once recording begins. The assistant opens automatically and the transcript stays available on demand.</p>
      <div className="mx-auto mt-7 max-w-md rounded-xl border border-black/[0.07] bg-black/[0.018] p-4 text-left">
        <div className="flex items-center justify-between gap-4 py-1.5 text-sm"><span className="text-black/45">Audio</span><span className="font-medium">{source === 'both' ? 'Microphone + system' : source === 'system' ? 'System audio' : 'Microphone'}</span></div>
        <div className="flex items-center justify-between gap-4 py-1.5 text-sm"><span className="text-black/45">Live profile</span><span className="font-medium">v{tuning.state.active.revision}</span></div>
        <div className="flex items-center justify-between gap-4 py-1.5 text-sm"><span className="text-black/45">Assistant</span><span className="font-medium">Opens on start</span></div>
      </div>
      <label className="mx-auto mt-5 flex max-w-md items-start gap-3 text-left text-sm text-black/60"><input type="checkbox" className="mt-0.5 h-4 w-4" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I have permission to record this conversation and use AI assistance where permitted.</span></label>
      <div className="mt-7 flex flex-wrap items-center justify-center gap-2">
        <button className="btn-signal gap-2 px-5" disabled={blocked || !consent} onClick={() => void begin()}><Mic size={16} />Start interview</button>
        <button className="btn-ghost gap-2" onClick={() => setSetupOpen((open) => !open)}><Settings2 size={15} />Configure</button>
      </div>
      {setupOpen && <fieldset className="mx-auto mt-6 grid max-w-md gap-4 border-t border-black/[0.07] pt-5 text-left">
        <label className="space-y-1.5 text-sm"><span className="text-black/55">Session title</span><input className="w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2.5" maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="space-y-1.5 text-sm"><span className="text-black/55">Audio source</span><select className="w-full rounded-lg border border-black/10 bg-white/70 px-3 py-2.5" value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="both">Call audio + my microphone</option><option value="system">Call / system audio only</option><option value="mic">My microphone only</option></select></label>
        <p className="text-xs leading-relaxed text-black/40">Use headphones with dual-channel capture to reduce echo. Raw audio is not saved by this workspace.</p>
      </fieldset>}
      {blocked && <p role="status" className="mt-4 text-sm">End Mock Lab before starting Live.</p>}
      {(error || call.error || microphone.error) && <p role="alert" className="mt-4 text-sm text-[color:var(--stop)]">{error || call.error || microphone.error}</p>}
    </section>
  </div>

  return <div className="space-y-4 sm:pr-[var(--interview-ask-w,0px)]" style={visible && askOpen ? { '--interview-ask-w': `${livePanelWidth}px` } as CSSProperties : undefined}>
    <section className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white/70 shadow-[0_18px_50px_rgba(0,0,0,0.06)]">
      <div className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3.5">
        <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.1em] text-emerald-700"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Live</span>
        <span className="text-sm font-semibold">{title || 'Live interview'}</span>
        <span className="ml-auto text-sm font-medium tabular-nums text-black/45">{formatTime(elapsed)}</span>
        <button className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-red-500 px-3.5 text-xs font-semibold text-white shadow-sm hover:bg-red-600 disabled:opacity-50" disabled={finishing} onClick={() => void finish()}><Square size={12} />End</button>
      </div>

      <div className="grid min-h-[64vh] xl:grid-cols-[minmax(0,1fr)_330px]">
        <div className="flex min-w-0 flex-col px-5 py-5 sm:px-7">
          <div className="flex flex-wrap items-center gap-2 text-xs text-black/45">
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">Question detection on</span>
            <span>Profile v{tuning.state.active.revision}</span>
          </div>
          <div className="flex flex-1 flex-col justify-center py-10">
            <div className="mx-auto w-full max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/35">Current question</p>
              <h2 className="mt-3 text-2xl font-semibold tracking-[-0.025em] sm:text-3xl">{busy ? 'Connecting audio…' : hasRecording ? 'Listening for the next question…' : 'Capture paused'}</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-black/45">When a question settles, the Interview Copilot streams a direct, speakable answer beside this workspace.</p>
              {!askOpen && <button className="mt-6 inline-flex items-center gap-1.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-white" disabled={!captured || !consent} onClick={() => setAskOpen(true)}>Open copilot <ChevronRight size={15} /></button>}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-black/[0.06] pt-3 text-xs text-black/45">
            {source !== 'system' && <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${microphone.phase === 'recording' ? 'bg-emerald-500' : 'bg-black/20'}`} />Mic</span>}
            {source !== 'mic' && <span className="inline-flex items-center gap-1.5"><span className={`h-1.5 w-1.5 rounded-full ${call.phase === 'recording' ? 'bg-emerald-500' : 'bg-black/20'}`} />System</span>}
            <button className="ml-auto rounded-md px-2 py-1.5 font-medium hover:bg-black/[0.04]" onClick={() => setTranscriptOpen((open) => !open)}>{transcriptOpen ? 'Hide transcript' : 'Transcript'}</button>
            <button className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 font-medium hover:bg-black/[0.04]" disabled={!captured} onClick={() => downloadInterview(title, text())}><Download size={13} />Export</button>
          </div>
        </div>

        {transcriptOpen && <aside className="border-t border-black/[0.07] bg-black/[0.018] p-4 xl:border-l xl:border-t-0">
          <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold">Transcript</h3><p className="mt-0.5 text-[11px] text-black/40">Live context</p></div><button className="text-xs text-black/40 hover:text-ink" onClick={() => setTranscriptOpen(false)}>Close</button></div>
          <div className="mt-4 max-h-[54vh] space-y-5 overflow-y-auto pr-1">
            {([{ name: 'Interviewer', rows: callRows, enabled: source !== 'mic' }, { name: 'You', rows: micRows, enabled: source !== 'system' }] as const).filter((channel) => channel.enabled).map(({ name, rows }) => <div key={name}><h4 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-black/35">{name}</h4><div className="space-y-2 text-xs leading-5">{rows.length === 0 ? <p className="text-black/30">Waiting for speech…</p> : rows.slice(-12).map((row) => <p key={row.id} className={row.isFinal ? 'text-black/65' : 'italic text-black/35'}>{row.text}</p>)}</div></div>)}
          </div>
        </aside>}
      </div>
    </section>
    {(error || call.error || microphone.error) && <p role="alert" className="text-sm text-[color:var(--stop)]">{error || call.error || microphone.error}</p>}
    {visible && askOpen && <CopilotPanel getTranscript={text} onClose={() => setAskOpen(false)} width={livePanelWidth} onResizeStart={panel.onResizeStart} />}
  </div>
}
