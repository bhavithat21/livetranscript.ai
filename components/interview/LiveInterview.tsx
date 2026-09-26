'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { AudioLines, Download, FileText, Headphones, Mic, Monitor, Play, Settings2, ShieldCheck, Sparkles, Square } from 'lucide-react'
import { ReadingControls } from '@/components/transcript/ReadingControls'
import { ListeningIndicator } from '@/components/transcript/ListeningIndicator'
import { useTextScale } from '@/lib/transcript/useTextScale'
import { liveTurns, voiceLabel, type ChannelSegment } from '@/lib/interview/liveTurns'
import { LiveScrollArea } from '@/components/transcript/LiveScrollArea'
import { LiveAnswerCanvas } from './LiveAnswerCanvas'
import type { AudioEvidence } from '@/lib/rehearsal/report'
import type { RepositoryCoachProps } from '@/components/coach/RepositoryCoach'
import { RepositoryCoach } from '@/components/coach/RepositoryCoach'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import { liveTranscript, useInterviewRecorder } from '@/lib/interview/useInterviewRecorder'
import { detectionTranscript } from '@/lib/interview/detectionTranscript'
import { downloadInterview } from '@/lib/interview/client'
import { useInterviewTuning } from '@/lib/interview/TuningContext'
import type { DialogueTurn } from '@/lib/coach/types'
import type { InterviewSession } from '@/lib/interview/session'
import styles from './Interview.module.css'

export function LiveInterview({ blocked, onActivity, onComplete, videoTest = false, rehearsal = false, onCoachReady, onAudioEvidence, frozenLessons }: {
  frozenLessons?: RepositoryCoachProps['frozenLessons'];
  rehearsal?: boolean; onCoachReady?: RepositoryCoachProps['onReady']; onAudioEvidence?: (e: AudioEvidence) => void;
  videoTest?: boolean; visible: boolean; blocked: boolean; onActivity: (active: boolean) => void
  onComplete: (session: InterviewSession) => void
}) {
  const call = useInterviewRecorder()
  const microphone = useInterviewRecorder()
  const tuning = useInterviewTuning()
  const { scale } = useTextScale()
  const [interviewerSpeaker, setInterviewerSpeaker] = useState<number | null>(null)
  const { keyterms } = useKeytermPrefs()
  const [source, setSource] = useState<'both' | 'system' | 'mic'>(videoTest ? 'system' : 'both')
  const [title, setTitle] = useState(rehearsal ? 'Interactive rehearsal' : videoTest ? 'Video coding test' : 'Live interview')
  const [consent, setConsent] = useState(false)
  const [repositoryMode, setRepositoryMode] = useState(videoTest || rehearsal)
  const [active, setActive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [setupOpen, setSetupOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [captureStartedAt, setCaptureStartedAt] = useState(0)
  const startTime = useRef(0)
  const ending = useRef(false)
  const lifecycle = useRef(0)
  useEffect(() => () => { lifecycle.current += 1 }, [])
  const sessionId = useRef('')
  const activity = useRef(false)
  const getCallSegments = call.getSegments
  const getMicSegments = microphone.getSegments
  const text = useCallback(() => liveTranscript(
    source === 'mic' ? [] : getCallSegments().filter((row) => row.capturedAt >= startTime.current),
    source === 'system' ? [] : getMicSegments().filter((row) => row.capturedAt >= startTime.current),
  ), [getCallSegments, getMicSegments, source])

  // Detection consumes only finalized interviewer-channel text. The richer
  // labeled dual-channel transcript remains the answer's grounding context.
  const questionText = useCallback(() => (videoTest || rehearsal) && interviewerSpeaker === null ? '' : detectionTranscript(
    (source === 'mic' ? getMicSegments() : getCallSegments()).filter((row) => row.capturedAt >= startTime.current),
    source === 'both' ? getMicSegments().filter((row) => row.capturedAt >= startTime.current) : [],
    interviewerSpeaker,
  ), [getCallSegments, getMicSegments, source, interviewerSpeaker, videoTest, rehearsal])

  const conversation = useCallback((): DialogueTurn[] => {
    const incoming = (source === 'mic' ? getMicSegments() : getCallSegments()).filter(row => row.isFinal && row.capturedAt >= startTime.current)
    const local = source === 'both' ? getMicSegments().filter(row => row.isFinal && row.capturedAt >= startTime.current) : []
    return [...incoming.map(row => ({ sourceId: `call:${row.id}`, at: row.capturedAt, role: (interviewerSpeaker === null || row.speaker === null ? 'unknown' : row.speaker === interviewerSpeaker ? 'interviewer' : 'candidate') as DialogueTurn['role'], text: row.text.slice(-1000) })),
      ...local.map(row => ({ sourceId: `mic:${row.id}`, at: row.capturedAt, role: 'candidate' as const, text: row.text.slice(-1000) }))]
      .filter(row => row.text.trim()).sort((a,b) => a.at-b.at).slice(-24)
  }, [getCallSegments, getMicSegments, source, interviewerSpeaker])

  const audioReporter = useRef(onAudioEvidence)
  useEffect(() => { audioReporter.current = onAudioEvidence }, [onAudioEvidence])
  useEffect(() => {
    audioReporter.current?.({ at: Date.now(), callFinals: call.segments.filter(r => r.isFinal).length, micFinals: microphone.segments.filter(r => r.isFinal).length,
      callPhase: call.phase, micPhase: microphone.phase, interviewerAssigned: interviewerSpeaker !== null, error: !!(call.error || microphone.error) })
  }, [call.segments, microphone.segments, call.phase, microphone.phase, call.error, microphone.error, interviewerSpeaker])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - startTime.current) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])

  async function begin() {
    if (activity.current || blocked || !consent) return
    const token = ++lifecycle.current
    activity.current = true; ending.current = false; sessionId.current = crypto.randomUUID(); startTime.current = Date.now()
    setInterviewerSpeaker(null); setCaptureStartedAt(startTime.current); setElapsed(0); setError(null); setBusy(true); setActive(true); setTranscriptOpen(true); onActivity(true)
    try {
      if (source !== 'mic') await call.start('system', keyterms)
      if (token === lifecycle.current && !ending.current && source !== 'system') await microphone.start('mic', keyterms, source === 'mic' ? 5 : 1)
    } catch (e) {
      if (token !== lifecycle.current) return
      await Promise.all([call.stop(), microphone.stop()])
      if (token !== lifecycle.current) return
      activity.current = false; setActive(false); onActivity(false)
      if (!ending.current) setError(e instanceof Error ? e.message : 'Could not start audio capture.')
    } finally { if (token === lifecycle.current && !ending.current) setBusy(false) }
  }

  async function finish() {
    if (ending.current || !activity.current) return
    lifecycle.current += 1
    ending.current = true; setFinishing(true); setBusy(true)
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
  const transcriptRows: ChannelSegment[] = [
    ...(source === 'mic' ? [] : callRows.map((row) => ({ ...row, channel: 'call' as const }))),
    ...(source === 'system' ? [] : micRows.map((row) => ({ ...row, channel: 'mic' as const }))),
  ].sort((a, b) => a.capturedAt - b.capturedAt).slice(-160)
  const turns = liveTurns(transcriptRows)
  const callSpeakers = [...new Set((source === 'mic' ? micRows : callRows).flatMap(row => row.speaker == null ? [] : [row.speaker]))].sort((a, b) => a - b)
  const readingStyle = { '--live-text-size': `${18 * scale}px` } as CSSProperties
  const captureStatus = finishing ? 'Saving transcript…' : busy ? 'Connecting audio…' : hasRecording ? 'Listening' : 'Audio paused'
  if (!active) return <div>
    <section className={styles.liveStage} style={readingStyle} aria-labelledby="live-setup-heading">
      <div className={styles.liveTopbar}><span className={styles.liveMark}><AudioLines size={17} aria-hidden /></span><span className={styles.liveTitle}>A clear space for your next conversation</span><span className={styles.sessionTime}>Ready to set up</span></div>
      <div className={styles.setupGrid}>
        <div className={styles.setupMain}>
          <span className={styles.answerTag}>Live interview</span>
          <h2 id="live-setup-heading">Focus on the conversation.</h2>
          <p>Questions, grounded answers, and the live transcript stay together. Start your audio when everyone is ready.</p>
          <label className={styles.setupPermission}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I have permission to record this conversation and use AI assistance where permitted.</span></label>
          <label className={styles.setupPermission}><input type="checkbox" disabled={rehearsal} checked={repositoryMode} onChange={(event) => setRepositoryMode(event.target.checked)} /><span>Repository coding interview — guide navigation, track observed edits, and show Say now / Change / Verify. Share the IDE separately after starting.</span></label>
          <div className={styles.setupActions}>
            <button type="button" className={styles.startButton} disabled={blocked || !consent} onClick={() => void begin()}><Play size={15} aria-hidden />Start interview</button>
            <button type="button" className={styles.darkButton} aria-expanded={setupOpen} aria-controls="live-setup-fields" onClick={() => setSetupOpen((open) => !open)}><Settings2 size={15} aria-hidden />Configure</button>
          </div>
          {setupOpen && <fieldset id="live-setup-fields" className={styles.setupFields}>
            <legend className="sr-only">Interview configuration</legend>
            <label className={styles.field}>Session title<input maxLength={180} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className={styles.field}>Audio source<select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="both">Call audio + my microphone</option><option value="system">Call / system audio only</option><option value="mic">My microphone only</option></select></label>
            <p className={styles.setupNote}><Headphones size={14} aria-hidden />Use headphones with dual-channel capture to reduce echo.</p>
          </fieldset>}
          {blocked && <p role="status" className={styles.livePaused}>End Mock Lab before starting Live.</p>}
          {(error || call.error || microphone.error) && <p role="alert" className={styles.error}>{error || call.error || microphone.error}</p>}
        </div>
        <aside className={styles.setupAside} aria-label="Session setup summary">
          <h3>Set up for this session</h3>
          <dl className={styles.setupFacts}>
            <div className={styles.setupFact}><Monitor size={20} aria-hidden /><div><dt>{source === 'both' ? 'Microphone + system audio' : source === 'system' ? 'System audio' : 'Microphone'}</dt><dd>{source === 'both' ? 'Separate channels keep the interviewer’s questions and your responses in context.' : source === 'system' ? 'Capture the call. Your microphone will not be recorded separately.' : 'Capture speech near your microphone. Remote questions may be missing.'}</dd></div></div>
            <div className={styles.setupFact}><Sparkles size={20} aria-hidden /><div><dt>Live profile v{tuning.state.active.revision}</dt><dd>{repositoryMode ? 'Repository assistance uses the observed task and code evidence. Standard answer-profile calibration is separate.' : 'Your live instructions, answer preferences, and saved background guide each response.'}</dd></div></div>
            <div className={styles.setupFact}><FileText size={20} aria-hidden /><div><dt>A transcript to come back to</dt><dd>End the session to save its transcript in Feedback. Raw audio is not saved by this workspace.</dd></div></div>
          </dl>
        </aside>
      </div>
    </section>
    <div className={styles.liveHelp}><span><ShieldCheck size={14} className="mr-1.5 inline" aria-hidden />Audio starts only after you choose Start interview.</span><span>Test your instructions in Mock Lab before going live.</span></div>
  </div>

  return <div>
    <section className={styles.liveStage} style={readingStyle} aria-label="Active interview">
      <div className={styles.liveTopbar}>
        <span className={styles.liveMark}><AudioLines size={17} aria-hidden /></span>
        <span className={styles.liveTitle}>{title || 'Live interview'}</span>
        <ListeningIndicator active={hasRecording && !finishing} level={Math.max(call.level, microphone.level)} label={captureStatus} />
        <ReadingControls /><span className={styles.sessionTime}>{formatTime(elapsed)}</span>
        <button type="button" className={styles.endButton} disabled={finishing} onClick={() => void finish()}><Square size={12} aria-hidden />End</button>
      </div>
      {(videoTest || repositoryMode) && interviewerSpeaker === null && <p className={styles.activityNotice}>Choose the interviewer in Speakers to apply spoken requirement changes. Unknown and candidate voices cannot change the task. Video-test and rehearsal answers also wait for this assignment.</p>}
      <div className={`${styles.liveGrid} ${repositoryMode || !transcriptOpen ? styles.liveGridNoRail : ''}`}>
        <div className={styles.answerColumn}>
          {repositoryMode ? <RepositoryCoach frozenLessons={rehearsal ? frozenLessons : undefined} onReady={onCoachReady} permission={videoTest || rehearsal ? 'practice' : 'external-ai-allowed'} getQuestionTranscript={questionText} getConversation={conversation} /> : <LiveAnswerCanvas getTranscript={text} getQuestionTranscript={questionText} />}
          <div className={styles.captureBar}>
            {source !== 'system' && <span className={styles.channel}><span className={`${styles.channelDot} ${microphone.phase === 'recording' ? styles.channelDotOn : ''}`} /><Mic size={12} aria-hidden />Mic · {microphone.phase === 'recording' ? 'on' : 'waiting'}</span>}
            {source !== 'mic' && <span className={styles.channel}><span className={`${styles.channelDot} ${call.phase === 'recording' ? styles.channelDotOn : ''}`} /><Monitor size={12} aria-hidden />System · {call.phase === 'recording' ? 'on' : 'waiting'}</span>}
            <div className={styles.captureActions}><button type="button" className={styles.darkButton} aria-expanded={transcriptOpen} aria-controls="live-transcript" onClick={() => setTranscriptOpen((open) => !open)}><FileText size={13} aria-hidden />{transcriptOpen ? 'Hide transcript' : 'Transcript'}</button><button type="button" className={styles.darkButton} disabled={!captured} onClick={() => downloadInterview(title, text())}><Download size={13} aria-hidden />Export</button></div>
          </div>
        </div>
        {transcriptOpen && <aside id="live-transcript" className={styles.transcriptRail}>
          <div className={styles.railHeader}><h3>Transcript</h3><button type="button" onClick={() => setTranscriptOpen(false)}>Close</button></div>
          {callSpeakers.length > 0 && <details className={styles.speakerSettings}><summary>Speakers · {callSpeakers.length} detected</summary><label>Answer questions from<select aria-label="Interviewer voice" value={interviewerSpeaker ?? 'all'} onChange={event => setInterviewerSpeaker(event.target.value === 'all' ? null : Number(event.target.value))}><option value="all">All incoming voices</option>{callSpeakers.map(speaker => <option key={speaker} value={speaker}>Speaker {speaker + 1}</option>)}</select></label><p>Voices are separated automatically. Assign the interviewer only when you know who is speaking. Early labels can change.</p></details>}
          <LiveScrollArea className={styles.transcriptList} updateKey={transcriptRows} label="Interviewer and microphone transcript">
            {!turns.length ? <div className={styles.transcriptEmpty}><AudioLines size={23} aria-hidden /><p>{busy ? 'Connect your audio to begin.' : 'Speech will appear here as it is transcribed.'}</p></div> : turns.map(turn => <div key={turn.key} className={styles.transcriptTurn} data-speaker={turn.speaker ?? 'pending'} data-channel={turn.channel}><div className={styles.turnLabel}><strong>{voiceLabel(turn.channel, turn.speaker, interviewerSpeaker)}</strong><span>{formatTime(Math.max(0, Math.floor((turn.capturedAt - captureStartedAt) / 1000)))}</span></div><p>{turn.parts.map((part, index) => <span key={part.id} className={part.isFinal ? undefined : styles.interim}>{index > 0 ? ' ' : ''}{part.text}</span>)}</p></div>)}
          </LiveScrollArea>
          <div className={styles.railFooter}><ListeningIndicator active={hasRecording && !finishing} level={Math.max(call.level, microphone.level)} label={captureStatus} /><span className={styles.railHint}>Auto-follow · scroll up to review</span></div>
        </aside>}
      </div>
    </section>
    {(error || call.error || microphone.error) && <p role="alert" className={`${styles.errorBanner} mt-4`}>{error || call.error || microphone.error}</p>}
  </div>
}
