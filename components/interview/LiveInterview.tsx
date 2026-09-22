'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Mic, Sparkles, Square } from 'lucide-react'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { usePanelWidth } from '@/lib/copilot/usePanelWidth'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import { liveTranscript, useInterviewRecorder } from '@/lib/interview/useInterviewRecorder'
import { downloadInterview } from '@/lib/interview/client'
import type { InterviewSession } from '@/lib/interview/session'

export function LiveInterview({ visible, blocked, onActivity, onComplete }: {
  visible: boolean; blocked: boolean; onActivity: (active: boolean) => void
  onComplete: (session: InterviewSession) => void
}) {
  const call = useInterviewRecorder()
  const microphone = useInterviewRecorder()
  const { keyterms } = useKeytermPrefs()
  const panel = usePanelWidth()
  const [source, setSource] = useState<'both' | 'system' | 'mic'>('both')
  const [title, setTitle] = useState('Live interview')
  const [consent, setConsent] = useState(false)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [askOpen, setAskOpen] = useState(false)
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
    activity.current = true
    ending.current = false
    sessionId.current = crypto.randomUUID()
    startTime.current = Date.now()
    setCaptureStartedAt(startTime.current)
    setAskOpen(false)
    setElapsed(0)
    setError(null)
    setBusy(true)
    setActive(true)
    onActivity(true)
    try {
      if (source !== 'mic') await call.start('system', keyterms)
      if (!ending.current && source !== 'system') await microphone.start('mic', keyterms)
    } catch (e) {
      // Keep any already captured words. The user can finish/export even when a
      // second channel fails or permission is denied.
      await Promise.all([call.stop(), microphone.stop()])
      if (!ending.current) setError(e instanceof Error ? e.message : 'Could not start audio capture.')
    } finally { if (!ending.current) setBusy(false) }
  }

  async function finish() {
    if (ending.current || !activity.current) return
    ending.current = true
    setFinishing(true)
    setBusy(true)
    setAskOpen(false)
    try {
      const [callRows, micRows] = await Promise.all([call.stop(), microphone.stop()])
      // A channel not started this time may still hold the previous session.
      // Exclude both disabled sources and any rows from before this session.
      const transcript = liveTranscript(
        source === 'mic' ? [] : callRows.filter((row) => row.capturedAt >= startTime.current),
        source === 'system' ? [] : micRows.filter((row) => row.capturedAt >= startTime.current),
      )
      if (!transcript.trim()) {
        setError('No speech was captured. Check the selected audio source and start again.')
        return
      }
      onComplete({
        id: sessionId.current, kind: 'live', title: title.trim() || 'Live interview',
        createdAt: startTime.current, durationSeconds: Math.max(0, Math.round((Date.now() - startTime.current) / 1000)),
        transcript, turns: [],
        captureNote: source === 'both'
          ? 'Separate call/system audio and candidate microphone channels. Speaker numbers in the call channel do not identify the candidate. Microphone is presumed candidate; nearby voices/echo can be present. Arrival order is approximate, not synchronized word timing. AI/copilot suggestions are not included.'
          : source === 'system'
            ? 'System/call audio only. The candidate microphone was NOT captured separately; candidate answers may be missing. Do not infer candidate identity from speaker numbers. AI/copilot suggestions are not included.'
            : 'Microphone only, presumed to be the candidate. Interviewer questions may be missing. Nearby voices may also be present. AI/copilot suggestions are not included.',
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not finish the interview. Export the transcript before leaving.')
    } finally {
      activity.current = false
      ending.current = false
      setFinishing(false)
      setActive(false)
      setBusy(false)
      onActivity(false)
    }
  }

  const callRows = call.segments.filter((row) => row.capturedAt >= captureStartedAt)
  const micRows = microphone.segments.filter((row) => row.capturedAt >= captureStartedAt)
  const captured = (source !== 'mic' && callRows.length > 0) || (source !== 'system' && micRows.length > 0)
  const hasRecording = call.phase === 'recording' || microphone.phase === 'recording'
  return (
    <div className="space-y-5 sm:pr-[var(--interview-ask-w,0px)]" style={visible && askOpen ? { '--interview-ask-w': `${panel.width}px` } as CSSProperties : undefined}>
      <section className="reader-surface rounded-2xl p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-[family-name:var(--font-serif)] text-2xl">Live Interview</h2><p className="mt-2 text-sm text-black/60">Capture the conversation, open the existing AI copilot when permitted, then review your answers.</p></div>
          {active && <span role="status" className="rounded-full bg-black/5 px-3 py-2 text-sm tabular-nums">{busy ? 'Connecting / stopping' : hasRecording ? 'Recording' : 'Capture stopped'} · {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</span>}
        </div>
        <fieldset disabled={active} className="mt-5 grid gap-4 sm:grid-cols-2 disabled:opacity-70">
          <label className="space-y-1 text-sm">Session title<input className="w-full rounded-xl border border-black/15 bg-transparent p-3" maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label className="space-y-1 text-sm">Audio source<select className="w-full rounded-xl border border-black/15 bg-transparent p-3" value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="both">Call audio + my microphone</option><option value="system">Call / system audio only</option><option value="mic">My microphone only</option></select></label>
          <label className="flex items-start gap-3 text-sm sm:col-span-2"><input type="checkbox" className="mt-1 h-4 w-4" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I have permission to record this conversation and to use AI assistance where enabled.</span></label>
        </fieldset>
        <p className="mt-3 text-xs leading-relaxed text-black/60">For both channels, use headphones to reduce duplicate audio. In the browser, choose a shared surface with audio enabled. The desktop app uses its native system-audio capture. Raw audio is not saved by this workspace.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {!active ? <button className="btn-signal gap-2" disabled={blocked || !consent} onClick={() => void begin()}><Mic size={16} />Start live interview</button> : <button className="btn-signal gap-2" disabled={finishing} onClick={() => void finish()}><Square size={16} />End &amp; open feedback</button>}
          <button className="btn-ghost gap-2" disabled={!captured || !consent} onClick={() => setAskOpen((open) => !open)}><Sparkles size={16} />{askOpen ? 'Close copilot' : 'Open AI copilot'}</button>
          <button className="btn-ghost" disabled={!captured} onClick={() => downloadInterview(title, text())}>Export transcript</button>
        </div>
        {blocked && <p role="status" className="mt-3 text-sm">Finish the active mock interview before starting live capture.</p>}
        {(error || call.error || microphone.error) && <p role="alert" className="mt-3 text-sm text-[color:var(--stop)]">{error || call.error || microphone.error}</p>}
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        {([{ name: 'Call audio', recorder: call, rows: callRows, enabled: source !== 'mic' }, { name: 'Your microphone', recorder: microphone, rows: micRows, enabled: source !== 'system' }] as const).filter((channel) => channel.enabled).map(({ name, recorder, rows }) => (
          <section key={name} className="reader-surface min-w-0 rounded-2xl p-5">
            <h3 className="flex items-center justify-between gap-3 font-medium">{name}<span className="text-xs font-normal text-black/60">{recorder.phase}</span></h3>
            <meter className="mt-3 h-2 w-full" min={0} max={1} value={Math.min(1, recorder.level * 8)} aria-label={`${name} audio level`} />
            <div className="mt-4 max-h-[55vh] space-y-3 overflow-y-auto break-words text-base leading-relaxed" aria-label={`${name} transcript`} tabIndex={0}>
              {rows.length === 0 ? <p className="text-sm text-black/50">Speech will appear here after you start capture.</p> : rows.map((row) => <p key={row.id} className={row.isFinal ? '' : 'italic text-black/50'}>{row.speaker !== null && name === 'Call audio' && <span className="mr-2 text-xs text-black/50">Speaker {row.speaker + 1}</span>}{row.text}</p>)}
            </div>
          </section>
        ))}
      </div>
      {visible && askOpen && <CopilotPanel getTranscript={text} onClose={() => setAskOpen(false)} width={panel.width} onResizeStart={panel.onResizeStart} />}
    </div>
  )
}
