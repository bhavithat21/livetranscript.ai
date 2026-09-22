'use client'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { Markdown } from '@/components/copilot/Markdown'
import { usePanelWidth } from '@/lib/copilot/usePanelWidth'
import { CopilotCalibrationContext, useInterviewTuning } from '@/lib/interview/TuningContext'
import { MAX_CALIBRATION, hasAcceptedRun, tuningSession, type CopilotObservation, type TuningRun } from '@/lib/interview/tuning'
import { captureText, useInterviewRecorder } from '@/lib/interview/useInterviewRecorder'
import type { InterviewSession } from '@/lib/interview/session'

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
  const panel = usePanelWidth()
  const microphone = useInterviewRecorder()
  const [scenario, setScenario] = useState(SCENARIOS[0].text)
  const [expected, setExpected] = useState(SCENARIOS[0].expected)
  const [draft, setDraft] = useState<string | null>(null)
  const instructions = draft ?? tuning.state.active.instructions
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
  const transcript = useCallback(() => [scenario, micOn ? captureText(microphone.getSegments()) : ''].filter(Boolean).join('\n\n'), [scenario, micOn, microphone.getSegments])
  const observe = useCallback((result: CopilotObservation) => {
    if (!collecting.current) return
    setRuns((previous) => [...previous, { ...result, expected, verdict: 'unreviewed', notes: '' }].slice(-20) as TuningRun[])
  }, [expected])
  const observeRunning = useCallback((value: boolean) => { if (collecting.current) setAnswerRunning(value) }, [])

  function begin() {
    if (blocked || collecting.current || !scenario.trim()) return
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
      await microphone.stop()
      if (token === lifecycle.current) { setMicOn(false); setError(e instanceof Error ? e.message : 'Microphone failed. Use a pasted scenario instead.') }
    } finally {
      micLock.current = false
      if (token === lifecycle.current) setMicBusy(false)
    }
  }
  async function finish() {
    if (!collecting.current || stopping.current) return
    stopping.current = true
    collecting.current = false
    lifecycle.current += 1
    setRunning(false) // unmounting the production panel cancels its pending answer
    setAnswerRunning(false)
    try {
      await microphone.stop()
      if (runs.length) onComplete(tuningSession(runs, startedAt.current))
      else setNotice('Test ended without a completed copilot request. Nothing was scored or saved.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this report. Export the test examples before leaving.') }
    finally { stopping.current = false; setMicOn(false); setMicBusy(false); onActivity(false) }
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

  return <div className="space-y-5 sm:pr-[var(--mock-panel-w,0px)]" style={running && visible ? { '--mock-panel-w': `${panel.width}px` } as CSSProperties : undefined}>
    <section className="space-y-6 rounded-xl border border-black/[0.07] bg-white/50 p-5 sm:p-7">
      <div><h2 className="font-[family-name:var(--font-serif)] text-2xl">Mock Lab</h2><p className="mt-2 text-sm leading-relaxed text-black/60">Test the exact Live pipeline against realistic interview questions. The expected answer is held out from generation so you can catch regressions in directness, correctness, grounding, and latency.</p></div>
      <p className="rounded-lg border border-black/[0.06] bg-black/[0.025] px-3 py-2.5 text-sm text-black/60">Live profile: revision {tuning.state.active.revision}. Draft instructions are isolated until you review a successful test and choose Promote to Live.</p>
      <div className="flex flex-wrap gap-2">{SCENARIOS.map((item) => <button key={item.name} className="btn-ghost text-sm" disabled={answerRunning || micOn || blocked} onClick={() => { setScenario(item.text); setExpected(item.expected) }}>Load {item.name.toLowerCase()} scenario</button>)}</div>
      <label className="block space-y-2 text-sm">Scenario transcript / interviewer question<textarea rows={5} maxLength={40_000} value={scenario} disabled={answerRunning || micOn || blocked} onChange={(e) => setScenario(e.target.value)} className="w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2.5 outline-none transition focus:border-emerald-700/30 focus:ring-2 focus:ring-emerald-700/10" /></label>
      <label className="block space-y-2 text-sm">Expected behavior or reference answer (not sent to the answering model)<textarea rows={3} maxLength={2000} value={expected} disabled={answerRunning || blocked} onChange={(e) => setExpected(e.target.value)} className="w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2.5 outline-none transition focus:border-emerald-700/30 focus:ring-2 focus:ring-emerald-700/10" placeholder="Describe what a correct, useful response must contain." /></label>
      <label className="block space-y-2 text-sm">Draft live calibration instructions<textarea rows={4} maxLength={MAX_CALIBRATION} value={instructions} disabled={answerRunning || blocked} onChange={(e) => setDraft(e.target.value)} className="w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2.5 outline-none transition focus:border-emerald-700/30 focus:ring-2 focus:ring-emerald-700/10" placeholder="For example: Start with a direct answer. State assumptions. Keep the opening under 80 words. Never invent resume facts." /></label>
      <div className="flex flex-wrap gap-2">
        {!running ? <button className="btn-signal" disabled={blocked || !scenario.trim()} onClick={begin}>Open live copilot for mock test</button> : <>
          <button className="btn-ghost" disabled={micBusy || answerRunning} onClick={() => void toggleMic()}>{micOn ? 'Stop & append interviewer speech' : 'Dictate interviewer input'}</button>
          <button className="btn-ghost" disabled={answerRunning} onClick={() => setPanelKey((key) => key + 1)}>Reset copilot for clean replay</button>
          <button className="btn-signal" onClick={() => void finish()}>End test &amp; open feedback</button>
        </>}
        <button className="btn-ghost" disabled={blocked || answerRunning || !hasAcceptedRun(runs, instructions)} onClick={publish}>Apply to Live</button>
        <button className="btn-ghost" disabled={blocked || answerRunning || !tuning.state.previous} onClick={() => { tuning.rollback(); setDraft(null); setNotice('Previous live instructions restored as a new revision.') }}>Roll back live profile</button>
        <button className="btn-ghost" disabled={answerRunning || blocked} onClick={() => setDraft(null)}>Reset draft</button>
      </div>
      {running && <p role="status" className="text-sm">{answerRunning ? 'Live copilot is answering the test input…' : 'Use the copilot panel to select a mode and ask the scenario question, or enable Auto for settled transcript questions. Completed requests appear below.'}</p>}
      {micOn && <p className="whitespace-pre-wrap text-sm">{micBusy ? 'Connecting microphone…' : captureText(microphone.segments) || 'Speak an interviewer question.'}</p>}
      <p className="text-xs leading-relaxed text-black/60">The same CopilotPanel, mode routing, uploaded context, and answer endpoint are used in Live and Mock. Configure the mode and grounding in that panel. Calibration applies to standard copilot answers; the separate Repository Interview multi-agent pipeline is not calibrated here. Clean replay resets conversation state, not saved documents. Prompt tuning is not model-weight training.</p>
      {blocked && <p role="status" className="text-sm">End the live interview before running tests or applying calibration changes.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {(error || tuning.error || microphone.error) && <p role="alert" className="text-sm text-[color:var(--stop)]">{error || tuning.error || microphone.error}</p>}
    </section>
    {runs.length > 0 && <section className="space-y-4 rounded-xl border border-black/[0.07] bg-white/50 p-5 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Test results ({runs.length}/20 retained)</h3><button className="btn-ghost" disabled={!runs.some((run) => run.verdict === 'pass' && run.status === 'complete')} onClick={exportExamples}>Export accepted examples</button></div><p className="text-xs text-black/60">Times measure request start to first text and completion, excluding ASR and pre-request orchestration. Use the held-out expectation as the acceptance test. Mark Pass only when the response is correct, direct, speakable, and free of unnecessary transcript/meta disclaimers. Times exclude ASR and pre-request orchestration.</p>{runs.map((run) => <article key={run.id} className="space-y-3 border-t border-black/[0.07] py-5 first:border-t-0 first:pt-0 last:pb-0">
      <h4 className="font-medium">{run.question}</h4><p className="text-xs text-black/60">{run.mode} · {run.status} · First text: {run.firstTokenMs === null ? 'not observed' : `${Math.round(run.firstTokenMs)} ms`} · Completion: {Math.round(run.totalMs)} ms</p>
      {run.expected && <p className="whitespace-pre-wrap text-sm"><strong>Expected:</strong> {run.expected}</p>}
      <div className="max-h-80 overflow-auto break-words"><Markdown>{run.answer || run.error || 'No output'}</Markdown></div>
      {run.error && <p className="text-sm text-[color:var(--stop)]">{run.error}</p>}
      <label className="block space-y-1 text-sm">Review result<select value={run.verdict} onChange={(e) => updateRun(run.id, { verdict: e.target.value as TuningRun['verdict'] })} className="w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2.5 outline-none transition focus:border-emerald-700/30 focus:ring-2 focus:ring-emerald-700/10"><option value="unreviewed">Not reviewed</option><option value="pass" disabled={run.status !== 'complete'}>Pass — useful and correct for this test</option><option value="needs-work">Needs work</option></select></label>
      <label className="block space-y-1 text-sm">System improvement notes<textarea rows={2} maxLength={2000} value={run.notes} onChange={(e) => updateRun(run.id, { notes: e.target.value })} className="w-full rounded-lg border border-black/10 bg-white/60 px-3 py-2.5 outline-none transition focus:border-emerald-700/30 focus:ring-2 focus:ring-emerald-700/10" /></label>
      <details className="text-xs"><summary className="cursor-pointer">Calibration used for this request</summary><pre className="mt-2 whitespace-pre-wrap">{run.calibration || '(Live defaults; no calibration override)'}</pre></details>
    </article>)}</section>}
    {running && <div hidden={!visible}><CopilotCalibrationContext.Provider value={{ instructions, revision: tuning.state.active.revision, onResult: observe, onRunning: observeRunning }}><CopilotPanel key={panelKey} getTranscript={transcript} onClose={() => void finish()} width={panel.width} onResizeStart={panel.onResizeStart} /></CopilotCalibrationContext.Provider></div>}
  </div>
}
