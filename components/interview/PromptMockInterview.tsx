'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, CheckCheck, ClipboardCheck, FlaskConical, Mic, Play, RotateCcw, Square } from 'lucide-react'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { Markdown } from '@/components/copilot/Markdown'
import { CopilotCalibrationContext, useInterviewTuning } from '@/lib/interview/TuningContext'
import { MAX_CALIBRATION, hasAcceptedRun, tuningSession, type CopilotObservation, type TuningRun } from '@/lib/interview/tuning'
import { captureText, useInterviewRecorder } from '@/lib/interview/useInterviewRecorder'
import type { InterviewSession } from '@/lib/interview/session'
import styles from './Interview.module.css'

const SCENARIOS = [
  { name: 'Direct technical', text: 'Interviewer: What authentication methods can webhooks use?', expected: 'Answer immediately. Cover HMAC signatures, bearer/API tokens, Basic Auth, mTLS, and IP allowlisting as a supporting control. No transcript disclaimer.' },
  { name: 'Coding', text: 'Interviewer: Implement a per-user sliding-window rate limiter. Explain the data structure, concurrency concerns, complexity and boundary tests.', expected: 'Start with the algorithm and complexity, then a concise execution plan and correct code/tests.' },
  { name: 'System design', text: 'Interviewer: Design a reliable notification service. Clarify scale, explain retry and deduplication behavior, and discuss trade-offs.', expected: 'Start with requirements/scale, then architecture, retries/idempotency and explicit trade-offs. Diagram only if useful.' },
  { name: 'Behavioral grounding', text: 'Interviewer: Tell me about a time you disagreed with a technical decision. Use only experience supplied in your profile; ask for missing details rather than inventing them.', expected: 'Use only grounded candidate experience, give a speakable STAR answer, and never invent a story.' },
]

export function MockInterview({ blocked, visible = true, onActivity, onComplete }: {
  blocked: boolean; visible?: boolean; onActivity: (active: boolean) => void; onComplete: (session: InterviewSession) => void
}) {
  const tuning = useInterviewTuning()
  const microphone = useInterviewRecorder()
  const [scenario, setScenario] = useState(SCENARIOS[0].text)
  const [expected, setExpected] = useState(SCENARIOS[0].expected)
  const [draft, setDraft] = useState<string | null>(null)
  const instructions = draft ?? tuning.state.active.instructions
  const [finishing, setFinishing] = useState(false)
  const [running, setRunning] = useState(false)
  const [answerRunning, setAnswerRunning] = useState(false)
  const [runs, setRuns] = useState<TuningRun[]>([])
  const [micOn, setMicOn] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const [panelKey, setPanelKey] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const collecting = useRef(false)
  const startedAt = useRef(0)
  const lifecycle = useRef(0)
  const micLock = useRef(false)
  const stopping = useRef(false)
  useEffect(() => () => { collecting.current = false; lifecycle.current += 1 }, [])
  const getMicSegments = microphone.getSegments
  const transcript = useCallback(() => [scenario, micOn ? captureText(getMicSegments()) : ''].filter(Boolean).join('\n\n'), [scenario, micOn, getMicSegments])
  const observe = useCallback((result: CopilotObservation) => {
    if (!collecting.current) return
    setRuns((previous) => [...previous, { ...result, expected, verdict: 'unreviewed', notes: '' }].slice(-20) as TuningRun[])
  }, [expected])
  const observeRunning = useCallback((value: boolean) => { if (collecting.current) setAnswerRunning(value) }, [])

  function begin() {
    if (blocked || stopping.current || collecting.current || !scenario.trim()) return
    collecting.current = true
    lifecycle.current += 1
    startedAt.current = Date.now()
    setRuns([])
    setError(null)
    setNotice(null)
    setRunning(true)
    onActivity(true)
  }
  async function toggleMic() {
    if (micLock.current || !collecting.current) return
    micLock.current = true
    setMicBusy(true)
    const token = lifecycle.current
    try {
      if (micOn) {
        const rows = await microphone.stop()
        if (token !== lifecycle.current) return
        const words = captureText(rows)
        setScenario((previous) => [previous, words && `Interviewer (dictated): ${words}`].filter(Boolean).join('\n\n').slice(-40_000))
        setMicOn(false)
      } else {
        setMicOn(true)
        await microphone.start('mic')
      }
    } catch (e) {
      if (token !== lifecycle.current) return
      await microphone.stop()
      if (token === lifecycle.current) { setMicOn(false); setError(e instanceof Error ? e.message : 'Microphone failed. Use a pasted scenario instead.') }
    } finally {
      if (token === lifecycle.current) { micLock.current = false; setMicBusy(false) }
    }
  }
  async function finish() {
    if (!collecting.current || stopping.current) return
    stopping.current = true; setFinishing(true)
    collecting.current = false
    lifecycle.current += 1
    setRunning(false) // unmounting the production panel cancels its pending answer
    setAnswerRunning(false)
    try {
      await microphone.stop()
      if (runs.length) onComplete(tuningSession(runs, startedAt.current))
      else setNotice('Test ended without a completed copilot request. Nothing was scored or saved.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this report. Export the test examples before leaving.') }
    finally { setFinishing(false); micLock.current = false; stopping.current = false; setMicOn(false); setMicBusy(false); onActivity(false) }
  }
  function updateRun(id: string, update: Partial<Pick<TuningRun, 'verdict' | 'notes'>>) {
    setRuns((previous) => previous.map((run) => run.id === id ? { ...run, ...update } : run))
  }
  function publish() {
    if (blocked || answerRunning || !hasAcceptedRun(runs, instructions)) return
    tuning.publish(instructions)
    setNotice('Applied to Live Interview on this browser. New copilot requests use this profile; model weights were not changed.')
  }
  function exportExamples() {
    const accepted = runs.filter((run) => run.verdict === 'pass' && run.status === 'complete')
    const text = accepted.map((run) => JSON.stringify({ version: 1, question: run.question, scenario: run.transcript, mode: run.mode, instructions: run.instructions, calibration: run.calibration, response: run.answer, expected: run.expected, humanNotes: run.notes, firstTokenMs: run.firstTokenMs, totalMs: run.totalMs })).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-ndjson' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'copilot-tuning-examples.jsonl'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const accepted = hasAcceptedRun(runs, instructions)
  return <div>
    <ol className={styles.labSteps} aria-label="Test workflow"><li className={!runs.length ? styles.stepActive : undefined}><span>1</span>Set up a test</li><li className={runs.length && !accepted ? styles.stepActive : undefined}><span>2</span>Review the answer</li><li className={accepted ? styles.stepActive : undefined}><span>3</span>Apply to Live</li></ol>
    <div className={styles.labGrid}>
      <section className={styles.card} aria-labelledby="lab-scenario-heading">
        <div className={styles.cardHeader}><h2 id="lab-scenario-heading">Test scenario</h2><span className={styles.smallBadge}><FlaskConical size={12} aria-hidden />Live answer pipeline</span></div>
        <div className={styles.cardBody}>
          <label className={styles.field}>Scenario transcript / interviewer question<textarea className="resize-none" rows={5} maxLength={40_000} value={scenario} disabled={answerRunning || micOn || blocked} onChange={(e) => setScenario(e.target.value)} /></label>
          <div className={styles.scenarioChoices}>{SCENARIOS.map((item) => <button type="button" key={item.name} aria-label={`Load ${item.name.toLowerCase()} scenario`} aria-pressed={scenario === item.text} disabled={answerRunning || micOn || blocked} onClick={() => { setScenario(item.text); setExpected(item.expected) }}>{item.name}</button>)}</div>
          <div className={styles.labDivider}><label className={styles.field}>Expected behavior or reference answer (not sent to the answering model)<textarea className="resize-none" rows={3} maxLength={2000} value={expected} disabled={answerRunning || blocked} onChange={(e) => setExpected(e.target.value)} placeholder="Describe what a correct, useful response must contain." /></label><p className={styles.caption}>Use this checklist to judge the response after the test. The model does not see it.</p></div>
          {!running ? <button type="button" className={`btn-signal gap-2 ${styles.runButton}`} disabled={blocked || finishing || !scenario.trim()} onClick={begin}><Play size={14} aria-hidden />Open test workspace</button> : <div className={`${styles.actionRow} mt-5`}><button type="button" className="btn-ghost gap-2 text-xs" disabled={micBusy || answerRunning} onClick={() => void toggleMic()}><Mic size={13} aria-hidden />{micOn ? 'Stop & append interviewer speech' : 'Dictate interviewer input'}</button><button type="button" className="btn-ghost gap-2 text-xs" disabled={answerRunning} onClick={() => setPanelKey((key) => key + 1)}><RotateCcw size={13} aria-hidden />Reset copilot for clean replay</button><button type="button" className="btn-signal gap-2 text-xs" onClick={() => void finish()}><Square size={12} aria-hidden />End test &amp; open feedback</button></div>}
          {running && <p role="status" className={`${styles.labStatus} mt-4`}>{answerRunning ? 'Live copilot is answering the test input…' : 'Ask your scenario question in the workspace below, or enable Auto to detect settled transcript questions.'}</p>}
          {micOn && <p className={`${styles.labNotice} mt-4 whitespace-pre-wrap`}>{micBusy ? 'Connecting microphone…' : captureText(microphone.segments) || 'Speak an interviewer question.'}</p>}
        </div>
      </section>
      <section className={styles.card} aria-labelledby="lab-tuning-heading">
        <div className={styles.cardHeader}><h2 id="lab-tuning-heading">Tune your live profile</h2><span className={styles.smallBadge}>Active v{tuning.state.active.revision}</span></div>
        <div className={styles.cardBody}>
          <label className={styles.field}>Draft live calibration instructions<textarea className="resize-none" rows={6} maxLength={MAX_CALIBRATION} value={instructions} disabled={answerRunning || blocked} onChange={(e) => setDraft(e.target.value)} placeholder="Start with a direct answer. State assumptions. Keep the opening under 80 words. Never invent resume facts." /></label>
          <p className={`${styles.caption} mt-3`}>Draft changes stay in Mock Lab until a completed answer passes your review.</p>
          <div className={styles.labDivider}><p className={styles.labStatus}><CheckCheck size={16} className="shrink-0" aria-hidden />{accepted ? 'A passed test matches these instructions.' : 'Test and approve these instructions to apply them.'}</p><div className={`${styles.actionRow} mt-4`}><button type="button" className="btn-signal gap-2 text-xs" disabled={blocked || answerRunning || !accepted} onClick={publish}><ArrowUpRight size={14} aria-hidden />Apply to Live</button><button type="button" className="btn-ghost text-xs" disabled={answerRunning || blocked} onClick={() => setDraft(null)}>Reset draft</button></div><button type="button" className="btn-ghost mt-3 gap-2 text-xs" disabled={blocked || answerRunning || !tuning.state.previous} onClick={() => { tuning.rollback(); setDraft(null); setNotice('Previous live instructions restored as a new revision.') }}><RotateCcw size={13} aria-hidden />Roll back live profile</button></div>
        </div>
      </section>
    </div>
    {blocked && <p role="status" className={`${styles.labNotice} mt-4`}>End the live interview before running tests or applying calibration changes.</p>}
    {notice && <p role="status" className={`${styles.labNotice} mt-4`}>{notice}</p>}
    {(error || tuning.error || microphone.error) && <p role="alert" className={`${styles.errorBanner} mt-4`}>{error || tuning.error || microphone.error}</p>}
    {runs.length > 0 ? <section className={`${styles.card} ${styles.results}`} aria-labelledby="lab-results-heading">
      <div className={styles.cardHeader}><div><h3 id="lab-results-heading">Test results</h3><p className={`${styles.caption} mt-1`}>{runs.length} of 20 retained · Timings exclude transcription and preparation.</p></div><button type="button" className="btn-ghost text-xs" disabled={!runs.some((run) => run.verdict === 'pass' && run.status === 'complete')} onClick={exportExamples}>Export accepted examples</button></div>
      <div className={styles.resultsList}>{runs.map((run) => <article key={run.id} className={styles.result}>
        <div className={styles.resultTitle}><h4>{run.question}</h4><span className={`${styles.resultStatus} ${run.verdict === 'pass' ? styles.resultPass : run.verdict === 'needs-work' ? styles.resultNeedsWork : ''}`}>{run.verdict === 'pass' ? 'Pass' : run.verdict === 'needs-work' ? 'Needs work' : 'Awaiting review'}</span></div>
        <div className={styles.resultMeta}><span>{run.mode} · {run.status}</span><span>First text: {run.firstTokenMs === null ? 'not observed' : `${Math.round(run.firstTokenMs)} ms`}</span><span>Completion: {Math.round(run.totalMs)} ms</span></div>
        <div className={styles.resultAnswer}><Markdown>{run.answer || run.error || 'No output'}</Markdown></div>
        {run.error && <p className={`${styles.error} mt-2`}>{run.error}</p>}
        {run.expected && <p className={`${styles.caption} mt-4 whitespace-pre-wrap`}><strong>Review against:</strong> {run.expected}</p>}
        <div className={styles.resultReview}><label className={styles.field}>Review result<select value={run.verdict} onChange={(e) => updateRun(run.id, { verdict: e.target.value as TuningRun['verdict'] })}><option value="unreviewed">Not reviewed</option><option value="pass" disabled={run.status !== 'complete'}>Pass — useful and correct for this test</option><option value="needs-work">Needs work</option></select></label><label className={styles.field}>System improvement notes<textarea className="resize-none" rows={2} maxLength={2000} value={run.notes} onChange={(e) => updateRun(run.id, { notes: e.target.value })} /></label></div>
        <details className={styles.resultDetails}><summary>Calibration used for this request</summary><pre>{run.calibration || '(Live defaults; no calibration override)'}</pre></details>
      </article>)}</div>
    </section> : <section className={styles.labEmpty}><ClipboardCheck size={25} aria-hidden /><div><h3>Your test results will appear here</h3><p className={styles.caption}>Run a question, check the response against your criteria, and mark it Pass or Needs work.</p></div></section>}
    {running && <section hidden={!visible} className={styles.labPanel} aria-label="Live copilot test workspace"><div className={styles.cardHeader}><h3>Test workspace</h3><span className={styles.smallBadge}>Draft profile</span></div><CopilotCalibrationContext.Provider value={{ instructions, revision: tuning.state.active.revision, onResult: observe, onRunning: observeRunning }}><CopilotPanel key={panelKey} variant="workspace" getTranscript={transcript} /></CopilotCalibrationContext.Provider></section>}
    <details className={`${styles.resultDetails} mt-5`}><summary>What this test measures</summary><p>Live and Mock share mode routing, uploaded grounding, response preferences, and the answer endpoint. Configure the mode and grounding in the test workspace. Calibration applies to standard copilot answers; the separate Repository Interview multi-agent pipeline is not calibrated here. Clean replay resets conversation state, not saved documents. Prompt tuning does not change model weights.</p></details>
  </div>
}
