'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useProactive } from '@/lib/copilot/useProactive'
import { CoachController, httpCoachTransport, type CoachTransport } from '@/lib/coach/controller'
import { ScreenObserver, browserFrameSource, httpCapture, type CaptureTransport } from '@/lib/coach/screen'
import { nativeAvailable, nativeDisplays, nativeFrameSource, type NativeDisplay } from '@/lib/coach/native'
import { fileCoverage, resultCurrent } from '@/lib/coach/state'
import { nextInspection } from '@/lib/coach/context'
import { safePath } from '@/lib/coach/validation'
import type { CoachState, Permission, ResultRecord } from '@/lib/coach/types'
import styles from './RepositoryCoach.module.css'

const EMPTY_TRANSCRIPT = () => ''
type Resources = { controller: CoachController; screen: ScreenObserver }
export type RepositoryCoachProps = {
  getQuestionTranscript?: () => string
  permission?: Permission
  objective?: string
  onActivity?: (active: boolean) => void
  transport?: CoachTransport
  captureTransport?: CaptureTransport
  /** Dependency injection for isolated QA, never a production global. */
  onReady?: (resources: Resources) => void
}
function saveFile(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function RepositoryCoach({ transport = httpCoachTransport, captureTransport = httpCapture, onReady, ...props }: RepositoryCoachProps) {
  const [resources, setResources] = useState<Resources | null>(null)
  const readyRef = useRef(onReady)
  useEffect(() => { readyRef.current = onReady }, [onReady])
  useEffect(() => {
    const controller = new CoachController(transport)
    const screen = new ScreenObserver((observation, at) => controller.observe(observation, 'screen', at), captureTransport)
    const resource = { controller, screen }
    let active = true
    queueMicrotask(() => { if (active) { setResources(resource); readyRef.current?.(resource) } })
    return () => { active = false; screen.dispose(); controller.dispose() }
  }, [transport, captureTransport])
  return resources ? <CoachWorkspace key={resources.controller.sessionId} {...props} {...resources} /> : <div className={styles.root}><p className={styles.setup} role="status">Preparing repository workspace…</p></div>
}
function ReviewButtons({ result, state, controller }: { result: ResultRecord; state: CoachState; controller: CoachController }) {
  const [expanded, setExpanded] = useState(false), [note, setNote] = useState(''), [category, setCategory] = useState('correctness')
  const saved = state.feedback.findLast(item => item.resultId === result.id)
  return <div className={styles.feedback}>
    <button className={styles.button} disabled={result.status !== 'complete'} onClick={() => controller.feedback(result.id, 'pass', [], '')}>Useful</button>
    <button className={styles.button} onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>Needs work</button>
    {saved && <span className={styles.muted}>Review saved · {saved.verdict}</span>}
    {expanded && <><label>What should improve?<select className={styles.input} value={category} onChange={event => setCategory(event.target.value)}><option value="correctness">Correctness</option><option value="directness">Directness / spoken clarity</option><option value="navigation">Wrong file or location</option><option value="stale-context">Stale or missing context</option><option value="latency">Response time</option><option value="verbosity">Too much detail</option></select></label><label>Review note<textarea className={styles.input} maxLength={1500} rows={3} value={note} onChange={event => setNote(event.target.value)} /></label><button className={styles.button} onClick={() => { controller.feedback(result.id, 'needs-work', [category], note); setExpanded(false) }}>Save review</button></>}
  </div>
}
function CoachWorkspace({ controller, screen, getQuestionTranscript = EMPTY_TRANSCRIPT, permission, objective: presetObjective, onActivity }: Omit<RepositoryCoachProps, 'onReady' | 'transport' | 'captureTransport'> & Resources) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const capture = useSyncExternalStore(screen.subscribe, screen.getSnapshot, screen.getSnapshot)
  const [consent, setConsent] = useState(false)
  const [objective, setObjective] = useState(presetObjective || 'Investigate the current task and identify the smallest safe implementation change.')
  const [error, setError] = useState<string | null>(null), [reading, setReading] = useState(false), [exportAllowed, setExportAllowed] = useState(false)
  const [displays, setDisplays] = useState<NativeDisplay[]>([]), [displayId, setDisplayId] = useState(''), [selecting, setSelecting] = useState(false), [loadedReplay, setLoadedReplay] = useState(false)
  const screenshots = useRef<HTMLInputElement>(null), files = useRef<HTMLInputElement>(null), replayInput = useRef<HTMLInputElement>(null)
  const generation = useRef(0), mounted = useRef(true), previousSpeech = useRef('')
  const activity = useRef(onActivity)
  useEffect(() => { activity.current = onActivity }, [onActivity])
  const getter = useRef(getQuestionTranscript)
  useEffect(() => { getter.current = getQuestionTranscript }, [getQuestionTranscript])
  const running = state.status === 'running'
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; activity.current?.(false) } }, [])
  useEffect(() => { activity.current?.(running) }, [running])
  useEffect(() => { if (permission && state.status === 'idle') controller.start(permission, presetObjective || 'Follow the interviewer’s task using only observed repository evidence.') }, [permission, presetObjective, controller, state.status])
  const ask = useCallback((question: string) => { controller.question(question) }, [controller])
  const getQuestions = useCallback(() => getter.current(), [])
  useProactive(running, getQuestions, ask, { latestWins: true })
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      const finalText = getter.current()
      if (finalText && finalText !== previousSpeech.current) {
        const previous = previousSpeech.current; previousSpeech.current = finalText
        const added = finalText.startsWith(previous) ? finalText.slice(previous.length) : finalText.slice(-1000)
        if (added.trim()) controller.speech(added, 'interviewer')
      }
    }, 400)
    return () => clearInterval(timer)
  }, [controller, running])
  async function selectScreen(native = false) {
    setError(null); setSelecting(true)
    const token = ++generation.current
    try {
      const source = native ? await nativeFrameSource(displayId) : await browserFrameSource(() => { if (mounted.current && token === generation.current) void screen.stop() })
      if (!mounted.current || token !== generation.current || controller.getSnapshot().status !== 'running') { await source.stop(); return }
      await screen.attach(source, native ? 'native' : 'browser')
      if (!mounted.current || token !== generation.current || controller.getSnapshot().status !== 'running') { await screen.stop(); return }
      screen.watch(true)
    } catch (failure) { if (mounted.current && token === generation.current) setError(failure instanceof Error ? failure.message : 'Screen sharing is unavailable.') }
    finally { if (mounted.current && token === generation.current) setSelecting(false) }
  }
  function pause() { generation.current++; setSelecting(false); controller.pause(); screen.watch(false) }
  function end() { generation.current++; setSelecting(false); void screen.stop(); controller.end() }
  async function uploadScreens(selected: FileList | null) {
    if (!selected?.length) return
    const items = Array.from(selected), token = ++generation.current
    if (screenshots.current) screenshots.current.value = ''
    if (items.length > 12) { setError('Upload up to 12 screenshots at a time.'); return }
    screen.watch(false); setReading(true); setError(null)
    try {
      for (const file of items) {
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4_400_000) throw new Error('Each screenshot must be a PNG, JPEG or WebP under 4.4 MB.')
        const image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Could not read screenshot')); reader.readAsDataURL(file) })
        if (!mounted.current || token !== generation.current || controller.getSnapshot().status !== 'running') return
        if (!await screen.capture(image)) break
      }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not read screenshots') }
    finally { if (mounted.current) setReading(false) }
  }
  async function importFiles(selected: FileList | null) {
    if (!selected?.length) return
    const items = Array.from(selected), token = ++generation.current
    if (files.current) files.current.value = ''
    if (items.length > 40 || items.reduce((sum, file) => sum + file.size, 0) > 300_000) { setError('Select at most 40 text source files, totalling under 300 KB. Do not include credentials.'); return }
    screen.watch(false); setReading(true); setError(null)
    try {
      for (const file of items) {
        const path = safePath(file.webkitRelativePath || file.name)
        if (!/\.(?:[cm]?[jt]sx?|py|java|cs|go|rs|json|md|ya?ml|toml|xml|html|css|sql|txt)$/i.test(path)) throw new Error('Import text source, tests or configuration files only.')
        const content = await file.text()
        if (!mounted.current || token !== generation.current || controller.getSnapshot().status !== 'running') return
        if (content.includes('\0')) throw new Error('Binary files cannot be imported.')
        const lines = content.replaceAll('\r\n', '\n').split('\n')
        for (let start = 0; start < lines.length; start += 220) controller.observe({ files: [{ path, language: path.split('.').at(-1) || 'text', startLine: start + 1, lines: lines.slice(start, start + 220), confidence: 1, endOfFile: start + 220 >= lines.length }], visiblePaths: [path], terminal: '', requirements: [] }, 'file-import')
      }
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not import files') }
    finally { if (mounted.current) setReading(false) }
  }
  async function loadReplay(file?: File) {
    if (replayInput.current) replayInput.current.value = ''
    if (!file) return
    setError(null)
    if (file.size > 4_000_000) { setError('Replay exceeds 4 MB.'); return }
    const token = ++generation.current
    try {
      const value = await file.text()
      if (!mounted.current || token !== generation.current) return
      await screen.stop(); controller.loadReplay(value); setLoadedReplay(true)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not load replay') }
  }
  function start() { if (consent && objective.trim()) { controller.start('practice', objective.trim()); controller.question(objective.trim()) } }
  const talk = state.results.findLast(item => item.lane === 'talk' && resultCurrent(item, state))
  const guide = state.results.findLast(item => item.lane !== 'talk' && item.status === 'complete' && resultCurrent(item, state))
  const guiding = state.results.some(item => item.lane !== 'talk' && item.status === 'running' && resultCurrent(item, state))
  const failed = state.results.findLast(item => ['failed', 'cancelled'].includes(item.status) && resultCurrent(item, state))
  const replay = controller.getReplayInfo()
  const next = state.navigation ?? nextInspection(state), metrics = controller.getMetrics(), counts = state.files.map(fileCoverage), native = nativeAvailable()
  return <section className={styles.root} aria-label="Repository coach" data-testid="repository-coach">
    <header className={styles.header}><h2>Repository coach</h2><span className={styles.tag}>{state.status === 'idle' ? 'Set up' : loadedReplay ? 'Replay' : state.permission === 'practice' ? 'Practice' : 'AI-permitted session'}</span><span className={`${styles.muted} ${styles.spacer}`}>{state.status} · evidence v{state.evidenceVersion}</span></header>
    {state.status === 'idle' && <div className={styles.setup}><h3>Follow the code. Keep the conversation moving.</h3><p>Share only the IDE you are allowed to show. The coach keeps observed code separate from suggestions, asks for missing evidence, and never edits files or runs commands for you.</p><label className={styles.label} htmlFor="coach-objective">Practice task</label><textarea id="coach-objective" className={styles.input} rows={3} maxLength={2000} value={objective} onChange={event => setObjective(event.target.value)} /><label className={styles.permission}><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I may share this code with the configured AI providers. This is practice or a session that explicitly permits external AI.</span></label><button className={`${styles.button} ${styles.primary}`} disabled={!consent || !objective.trim()} onClick={start}>Start repository practice</button></div>}
    {state.status !== 'idle' && <>
      <div className={styles.controls}>
        <button className={styles.button} disabled={!running || selecting || reading || capture.reading} onClick={() => void selectScreen()}>{selecting ? 'Selecting…' : capture.sharing ? 'Change shared IDE' : 'Share IDE'}</button>
        {capture.sharing && <><button className={styles.button} disabled={!running || reading} onClick={() => screen.watch(!capture.watching)}>{capture.watching ? 'Pause screen watch' : 'Watch changes'}</button><button className={styles.button} disabled={!running || capture.reading || reading} onClick={() => void screen.captureNow()}>Capture now</button><button className={styles.button} onClick={() => void screen.stop()}>Stop sharing</button></>}
        <button className={styles.button} disabled={!running || capture.reading || reading} onClick={() => screenshots.current?.click()}>Add screenshots</button><input hidden ref={screenshots} type="file" multiple accept="image/png,image/jpeg,image/webp" aria-label="Repository screenshots" onChange={event => void uploadScreens(event.target.files)} />
        <button className={styles.button} disabled={!running || reading || capture.reading} onClick={() => files.current?.click()}>Import source files</button><input hidden ref={files} type="file" multiple aria-label="Repository source files" onChange={event => void importFiles(event.target.files)} />
        {running ? <button className={styles.button} onClick={pause}>Pause coach</button> : state.status === 'paused' && <button className={styles.button} disabled={loadedReplay && !state.question} onClick={() => loadedReplay ? controller.analyzeReplay() : controller.resume()}>{loadedReplay ? 'Analyze replay with AI' : 'Resume coach'}</button>}
        {state.status !== 'ended' && <button className={styles.button} onClick={end}>End coach</button>}
      </div>
      {native && <details className={`${styles.details} ${styles.main}`}><summary>Desktop display capture</summary><p>Use a selected display through the native app. This does not grant remote control. Screen-recording permission is required.</p><button className={styles.button} disabled={!running || selecting} onClick={() => { void nativeDisplays().then(items => { setDisplays(items); setDisplayId(items[0]?.id || '') }).catch(() => setError('Native capture requires the updated desktop installer and screen-recording permission.')) }}>Find displays</button>{displays.length > 0 && <label className={styles.label}>Display<select className={styles.input} value={displayId} onChange={event => setDisplayId(event.target.value)}>{displays.map(display => <option key={display.id} value={display.id}>{display.name} · {display.width} × {display.height}</option>)}</select><button className={styles.button} disabled={!running || !displayId || selecting} onClick={() => void selectScreen(true)}>Share selected display</button></label>}</details>}
      {(capture.sharing || capture.reading || reading) && <p className={styles.notice} role="status">{capture.reading ? 'Reading a changed view…' : reading ? 'Importing selected evidence…' : capture.watching ? 'Watching the selected IDE. Stable changed screenshots are sent to your configured vision provider.' : 'Screen selected; automatic screenshot analysis paused.'}</p>}
      {loadedReplay && <section className={styles.main} aria-label="Replay timeline">
        <label className={styles.label} htmlFor="coach-replay-checkpoint">Observation {replay.position} of {replay.total} · {replay.event}</label>
        <input id="coach-replay-checkpoint" aria-label="Replay checkpoint" type="range" min={1} max={Math.max(1, replay.total)} value={replay.position} className={styles.input} onChange={event => { screen.watch(false); controller.seekReplay(Number(event.target.value)) }} />
        <div className={styles.feedback}><button className={styles.button} disabled={replay.position <= 1} onClick={() => controller.seekReplay(replay.position - 1)}>Previous observation</button><button className={styles.button} disabled={replay.position >= replay.total} onClick={() => controller.seekReplay(replay.position + 1)}>Next observation</button></div>
        <p className={styles.muted}>Seeking is offline. Future screenshots and saved model answers are excluded from this checkpoint’s context. Analyze replay with AI sends only the evidence visible so far.</p>
        {replay.references.length > 0 && <details className={styles.details}><summary>Previous responses and saved feedback · reference only</summary><ul className={styles.list}>{replay.references.map((item, index) => <li key={`${item.id}-${index}`}><strong>{item.lane} · {item.model || 'Model not recorded'} · {item.verdict || 'Not reviewed'}</strong><pre className={styles.code}>{item.text || item.summary}</pre>{item.note && <p>Review: {item.note}</p>}</li>)}</ul></details>}
      </section>}
      {state.status === 'paused' && <p className={styles.notice}>Coach paused. No new model calls or screen analysis. The parent interview’s audio capture has separate controls.</p>}
      <div className={styles.layout}>
        <div className={styles.main} data-testid="coach-main">
          <div className={styles.eyebrow}>Current question</div><h3 className={styles.question}>{state.question?.text || 'Listening for the interviewer’s next question…'}</h3>
          <section className={styles.card} aria-label="Say now"><div className={styles.eyebrow}>Say now <span className={styles.spacer}>{talk?.status === 'running' ? 'Composing' : talk?.status === 'complete' ? 'Ready' : ''}</span></div><div className={styles.talk}>{talk?.text || 'Speech guidance will appear automatically when there is a question. Show the task and relevant code to ground it.'}</div>{talk && <><div className={styles.status}>{talk.model || 'Configured conversation model'}{talk.firstUsefulMs !== null ? ` · first text ${Math.round(talk.firstUsefulMs)} ms` : ''}{talk.totalMs !== null ? ` · total ${Math.round(talk.totalMs)} ms` : ''}</div><details className={styles.details}><summary>Review this response</summary><ReviewButtons controller={controller} state={state} result={talk} /></details></>}</section>
          <section className={styles.card} aria-label="Look at"><div className={styles.eyebrow}>Look at {guiding && <span className={styles.spacer}>Investigating…</span>}</div>{next ? <div className={styles.next}><strong>{next.path}{next.symbol ? ` → ${next.symbol}` : ''}</strong>{next.startLine !== null && <span>Show lines {next.startLine}{next.endLine !== null ? `–${next.endLine}` : ' onward'}. </span>}<p>{next.reason}</p><span className={styles.tag}>{next.status === 'seen' ? 'Requested view observed' : 'Waiting for the requested view'}</span></div> : <p className={styles.empty}>{state.knownPaths.length ? 'No further navigation target selected. Current code is available for analysis.' : 'Show the problem statement and file tree, then the entry point and relevant test. Unseen files will not be invented.'}</p>}</section>
          {state.task.implementation === 'hold' && <p className={styles.notice}>Implementation on hold: explain and gather evidence before proposing edits.</p>}
          {guide?.guidance && <>
            <p className={styles.next}>{guide.guidance.summary}</p>
            {guide.guidance.patches.map(patch => <section className={styles.card} key={patch.id} aria-label={`Proposed change in ${patch.path}`}><div className={styles.eyebrow}>Change · suggestion only</div><h3 className={styles.path}>{patch.path} · line {patch.startLine} · source v{patch.fileVersion}</h3><p className={styles.next}>{patch.reason}</p><div className={styles.grid2}><div><p className={styles.codeLabel}>Observed before</p><pre className={styles.code}>{patch.before}</pre></div><div><p className={styles.codeLabel}>Suggested after</p><pre className={styles.code}>{patch.after}</pre></div></div><p className={styles.status}>References: {patch.evidence.map(ref => `${ref.sourceId}, lines ${ref.startLine}–${ref.endLine}`).join('; ')}. No edit has been applied.</p></section>)}
            {guide.guidance.findings.length > 0 && <section className={styles.card} aria-label="Code review"><div className={styles.eyebrow}>Check</div><ul className={styles.list}>{guide.guidance.findings.map((finding, index) => <li key={index}><strong>{finding.severity} · {finding.category}</strong>{finding.text}<div className={styles.status}>{finding.evidence.map(ref => `${ref.path}:${ref.startLine ?? '?'} (${ref.sourceId})`).join(' · ')}</div></li>)}</ul></section>}
            {guide.guidance.verify.length > 0 && <section className={styles.card} aria-label="Verification suggestions"><div className={styles.eyebrow}>Verify · run yourself</div>{guide.guidance.verify.map((test, index) => <div key={index}><pre className={styles.code}>{test.command}</pre><p className={styles.muted}>{test.scope} · {test.reason}</p><button className={styles.button} disabled={!running} onClick={() => controller.markTestStart(test.command)}>Mark test start</button><p className={styles.status}>Marks when you start the command. Does not execute it. Share fresh terminal output afterward.</p></div>)}</section>}
            <details className={styles.details}><summary>Review this investigation</summary><ReviewButtons result={guide} controller={controller} state={state} /></details>
          </>}
          {state.patchReviews.length > 0 && <section className={styles.card} aria-label="Observed edits"><div className={styles.eyebrow}>Observed edit check</div><ul className={styles.list}>{state.patchReviews.map(review => <li key={review.patchId}><strong>{review.status.replaceAll('-', ' ')}</strong>{review.detail}</li>)}</ul><p className={styles.status}>Text matching is not proof of correctness. Equivalent alternatives require review; tests provide separate evidence.</p></section>}
          {failed && <div className={`${styles.notice} ${styles.error}`} role="alert">{failed.error}<button className={styles.button} disabled={!running} onClick={() => void controller.run(failed.lane, true)}>Retry {failed.lane}</button></div>}
        </div>
        <aside className={styles.aside} aria-label="Repository evidence">
          <div className={styles.eyebrow}>Evidence, not assumptions</div><p className={styles.muted}>{state.files.length} files read · {state.knownPaths.length} paths seen<br />{counts.filter(item => item.complete).length} observed through EOF · code v{state.codeVersion}</p>
          <ul className={styles.list}>{state.files.map((file, index) => <li key={file.path}><strong className={styles.path}>{file.path}</strong>{counts[index].complete ? 'Observed through EOF' : 'Partial'} · v{file.version} · {counts[index].observed} observed lines{file.retired.length > 0 && <div className={styles.warning}>Prior anchors retired after a changed view.</div>}</li>)}</ul>
          <details className={styles.details}><summary>Task and constraints</summary><p>{state.task.objective}</p><ul className={styles.list}>{[...state.task.requirements, ...state.task.constraints].map((constraint, index) => <li key={index}>{constraint}</li>)}</ul><p>Phase: {state.task.phase}. Extraction confidence scores are not calibrated probabilities.</p></details>
          <section aria-label="Observed test output"><div className={styles.eyebrow}>Test evidence</div>{!state.tests.length ? <p className={styles.muted}>No test output observed.</p> : <ul className={styles.list}>{state.tests.map(test => <li key={test.id}><strong>{test.status}</strong>{test.passed ?? '?'} passed · {test.failed ?? '?'} failed<div>{test.codeVersion === null ? 'Not linked to a known code revision' : `Observed for code v${test.codeVersion}`}</div><details><summary>Output</summary><pre className={styles.code}>{test.output || 'Waiting for fresh terminal output'}</pre></details></li>)}</ul>}</section>
          <details className={styles.details}><summary>Recent screen text</summary><pre className={styles.code}>{state.lastScreen ? JSON.stringify(state.lastScreen.observation, null, 2) : 'Nothing captured.'}</pre></details>
        </aside>
      </div>
    </>}
    {(error || capture.error || state.warning) && <p className={`${styles.notice} ${styles.error}`} role="alert">{error || capture.error || state.warning}</p>}
    <footer className={styles.footer}><span>{metrics.modelRequests} model calls · {capture.captures} extracted frames · {capture.localSamples} local samples</span><span>No repository writes or command execution</span></footer>
    <details className={`${styles.details} ${styles.main}`}><summary>Mock replay and feedback</summary><p>Replay imports only observations. Loading is offline; Analyze replay explicitly makes model calls. Exports include selected source code and transcript fragments, so inspect them before sharing.</p><label className={styles.permission}><input type="checkbox" checked={exportAllowed} onChange={event => setExportAllowed(event.target.checked)} /><span>I may export this session’s selected code, transcript fragments, model outputs, and reviews.</span></label><div className={styles.feedback}><button className={styles.button} disabled={!exportAllowed || !state.sequence} onClick={() => saveFile('repository-coach-replay.json', controller.exportReplay())}>Export replay + feedback</button><button className={styles.button} disabled={running || reading} onClick={() => replayInput.current?.click()}>Load replay offline</button><input hidden type="file" accept="application/json,.json" ref={replayInput} aria-label="Load repository replay" onChange={event => void loadReplay(event.target.files?.[0])} /></div></details>
  </section>
}
