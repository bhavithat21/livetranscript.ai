'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { RealtimeSimulator } from '@/lib/coach/simulation/runner'
import { SCENARIOS } from '@/lib/coach/simulation/scenarios'
import type { SimReport } from '@/lib/coach/simulation/types'
import { useFollowLatest } from '@/lib/transcript/useFollowLatest'
import { resultCurrent } from '@/lib/coach/state'
import styles from './SimulationLab.module.css'

function download(value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = 'livetranscript-simulator-report.json'; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function SimulationLab({ visible = true, onActivity }: { visible?: boolean; onActivity?: (active: boolean) => void }) {
  const [scenarioId, setScenarioId] = useState('conversation'), [seed, setSeed] = useState(1), [generation, setGeneration] = useState(0)
  const [simulator, setSimulator] = useState<RealtimeSimulator | null>(null)
  const [busy, setBusy] = useState(false), [playing, setPlaying] = useState(false), [reports, setReports] = useState<SimReport[]>([]), [error, setError] = useState('')
  const alive = useRef(true), operation = useRef(0), activity = useRef(onActivity)
  const scenario = SCENARIOS.find(item => item.id === scenarioId)!
  useEffect(() => { activity.current = onActivity }, [onActivity])
  useEffect(() => { activity.current?.(playing || busy) }, [playing, busy])
  useEffect(() => { alive.current = true; return () => { alive.current = false; activity.current?.(false) } }, [])
  useEffect(() => {
    const instance = new RealtimeSimulator(scenario, seed)
    let mounted = true
    queueMicrotask(() => { if (mounted) setSimulator(instance) })
    return () => { mounted = false; instance.dispose() }
  }, [scenario, seed, generation])
  useEffect(() => { if (!visible) { operation.current++; queueMicrotask(() => { if (alive.current) setPlaying(false) }) } }, [visible])
  async function runAll() {
    if (busy || playing) return
    const token = ++operation.current
    setBusy(true); setReports([]); setError('')
    const collected: SimReport[] = []
    try {
      for (const scenario of SCENARIOS) {
        if (!alive.current || token !== operation.current) break
        const test = new RealtimeSimulator(scenario, seed)
        try { collected.push(await test.finish()) } finally { test.dispose() }
        if (alive.current && token === operation.current) setReports([...collected])
        // Yield between scenarios so cancellation and rendering remain responsive.
        await new Promise(resolve => setTimeout(resolve, 0))
      }
    } catch (failure) { if (alive.current) setError(failure instanceof Error ? failure.message : 'Simulation failed') }
    finally { if (alive.current) setBusy(false) }
  }
  return <section className={styles.root} aria-label="Real-time simulator">
    <header className={styles.header}><div><span className={styles.eyebrow}>Mock Lab / Runtime verification</span><h2>Real-time simulator</h2><p>Reproduce the conversation, code changes, and request races before they reach Live.</p></div><span className={styles.badge}>Synthetic · no API calls</span></header>
    <div className={styles.toolbar}>
      <label>Scenario<select aria-label="Simulation scenario" value={scenarioId} disabled={playing || busy} onChange={e => { setScenarioId(e.target.value); setError('') }}>{SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Seed<input aria-label="Simulation seed" type="number" min={0} max={999999} value={seed} disabled={playing || busy} onChange={e => { const value = Number(e.target.value); if (Number.isInteger(value) && value >= 0 && value <= 999999) setSeed(value) }} /></label>
      <button disabled={playing || busy} onClick={() => { setGeneration(v => v + 1); setError('') }}>Reset scenario</button>
      <button disabled={playing || busy} onClick={() => void runAll()}>Run all {SCENARIOS.length} scenarios</button>
      {busy && <button onClick={() => { operation.current++ }}>Cancel suite</button>}
    </div>
    <p className={styles.description}>{scenario.description}</p>
    {simulator && <Timeline key={`${scenarioId}:${seed}:${generation}`} simulator={simulator} playing={playing} setPlaying={setPlaying} disabled={busy || !visible} onError={setError} />}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {reports.length > 0 && <section className={styles.report} aria-label="Simulation suite results"><h3>Runtime checks · {reports.filter(r => r.passed).length}/{reports.length} scenarios passed</h3><button onClick={() => download({ format: 'livetranscript-simulator-suite-v1', seed, reports, providerInference: false, rawAudioTested: false, screenshotExtractionTested: false })}>Export suite report</button>{reports.map(report => <details key={report.scenarioId}><summary>{report.passed ? 'PASS' : 'FAIL'} · {report.scenarioId} · {report.checks.length} checks</summary>{report.checks.map(c => <p key={c.id}>{c.passed ? '✓' : '✕'} {c.label}{!c.passed && ` — expected ${c.expected}; got ${c.actual}`}</p>)}</details>)}</section>}
    <footer className={styles.footer}>The real Live question scheduler, context builder, evidence validator, and coach controller run against injected speech/text observations and fault-controlled responses. This is not YouTube playback, acoustic speaker recognition, screenshot extraction, or a model-quality/latency benchmark. Simulator results cannot activate learned policies. Use Video test for the real audio/screen/provider path.</footer>
  </section>
}
function Timeline({ simulator, playing, setPlaying, disabled, onError }: { simulator: RealtimeSimulator; playing: boolean; setPlaying: (value: boolean) => void; disabled: boolean; onError: (value: string) => void }) {
  const snapshot = useSyncExternalStore(simulator.subscribe, simulator.getSnapshot, simulator.getSnapshot)
  const [speed, setSpeed] = useState(1), [working, setWorking] = useState(false)
  const advancing = useRef(false), mounted = useRef(true)
  const { viewportRef, contentRef, following, resume: resumeFollowing } = useFollowLatest(snapshot.state.conversation)
  const duration = simulator.scenario.duration, done = snapshot.time >= duration
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!playing || disabled || done) { if (done || disabled) setPlaying(false); return }
    let stopped = false, timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      if (stopped || advancing.current) return
      advancing.current = true
      try { await simulator.advance(100 * speed) } catch (error) { if (!stopped) { onError(error instanceof Error ? error.message : 'Clock failed'); setPlaying(false) } }
      finally { advancing.current = false }
      if (!stopped) timer = setTimeout(() => void tick(), 100)
    }
    timer = setTimeout(() => void tick(), 100)
    return () => { stopped = true; clearTimeout(timer) }
  }, [simulator, playing, disabled, done, speed, setPlaying, onError])
  async function advance(ms: number) {
    if (advancing.current) return
    advancing.current = true; setWorking(true)
    try { await simulator.advance(ms) } catch (e) { if (mounted.current) onError(e instanceof Error ? e.message : 'Simulation failed') }
    finally { advancing.current = false; if (mounted.current) setWorking(false) }
  }
  const state = snapshot.state, talk = state.results.findLast(r => r.lane === 'talk' && resultCurrent(r, state)), guide = state.results.findLast(r => r.lane !== 'talk' && r.status === 'complete' && resultCurrent(r, state))
  const nextTime = simulator.scenario.events[snapshot.events]?.at ?? duration
  const report = done ? simulator.report() : null
  return <>
    <div className={styles.controls}><button disabled={disabled || done || working} onClick={() => setPlaying(!playing)}>{playing ? 'Pause timeline' : 'Play in real time'}</button><button disabled={disabled || playing || done || working} onClick={() => void advance(Math.max(1, nextTime - snapshot.time))}>Next event</button><button disabled={disabled || playing || done || working} onClick={() => void advance(duration - snapshot.time)}>Run to end</button><label>Playback speed<select aria-label="Simulation playback speed" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[.5, 1, 2, 4].map(n => <option key={n} value={n}>{n}×</option>)}</select></label><span className={styles.time}>{(snapshot.time / 1000).toFixed(1)} / {duration / 1000}s simulated</span></div>
    <progress className={styles.progress} value={snapshot.time} max={duration} aria-label="Simulation progress" />
    <div className={styles.grid}>
      <div className={styles.surface}><h3>Observed coding screen</h3><p className={styles.muted}>Synthetic editor / terminal; future events stay hidden</p>{state.lastScreen?.observation.files.map((file, i) => <div key={`${file.path}:${i}`}><strong className={styles.path}>{file.path}</strong><pre>{file.lines.map((line, n) => `${(file.startLine ?? 1) + n}  ${line}`).join('\n')}</pre></div>)}{state.lastScreen?.observation.terminal && <pre>{state.lastScreen.observation.terminal}</pre>}{!state.lastScreen && <p>Waiting for the first screen event.</p>}<h3>Conversation</h3><div className={styles.conversation} ref={viewportRef} tabIndex={0} aria-label="Simulated conversation"><div ref={contentRef}>{(state.conversation ?? []).map(turn => <p key={turn.sourceId}><strong>{turn.role}</strong> {turn.text}</p>)}</div></div>{!following && <button onClick={resumeFollowing}>Jump to latest speech</button>}</div>
      <div className={styles.surface}><h3>Agent output</h3><p className={styles.muted}>Scripted responses exercise the real controller; not generated solutions</p><div className={styles.answer}><span className={styles.eyebrow}>Current question</span><p>{state.question?.text ?? 'Waiting for a complete interviewer question…'}</p><span className={styles.eyebrow}>Say now</span><p>{talk?.text || (talk?.status === 'running' ? 'Request running…' : talk?.error || 'No answer dispatched yet.')}</p>{guide?.guidance && <><span className={styles.eyebrow}>Look at / Change / Verify</span><p>{guide.guidance.summary}</p>{guide.guidance.patches.map(p => <pre key={p.id}>{p.path}{'\n'}{p.after}</pre>)}</>}<p className={styles.muted}>Coach: {state.status} · evidence v{state.evidenceVersion} · code v{state.codeVersion} · {state.task.implementation === 'hold' ? 'Implementation on hold' : 'Implementation allowed'}</p></div><h3>Transport requests</h3><ol className={styles.requests}>{snapshot.requests.map((r, i) => <li key={i}>{(r.at / 1000).toFixed(1)}s · {r.lane} · <strong>{r.status}</strong></li>)}</ol></div>
    </div>
    <details className={styles.events}><summary>Event log · {snapshot.events} delivered</summary><ol>{simulator.scenario.events.slice(0, snapshot.events).map((e, i) => <li key={i}>{(e.at / 1000).toFixed(1)}s — {e.label}</li>)}</ol></details>
    {report && <section className={styles.report} aria-label="Scenario result"><h3>{report.passed ? 'PASS' : 'FAIL'} · {report.checks.filter(c => c.passed).length}/{report.checks.length} runtime checks</h3>{report.checks.map(c => <p key={c.id}>{c.passed ? '✓' : '✕'} {c.label}{!c.passed && ` — expected ${c.expected}; got ${c.actual}`}</p>)}<button onClick={() => download(report)}>Export scenario report</button></section>}
  </>
}
