'use client'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Download, FileCode2, FolderOpen, Mic, Monitor, Pause, Play, RotateCcw, ShieldCheck, Square, Upload } from 'lucide-react'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { useInterviewRecorder } from '@/lib/interview/useInterviewRecorder'
import { detectionTranscript } from '@/lib/interview/detectionTranscript'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import { coverage } from '@/lib/repo/live/engine'
import { exportSession, importSession, canImport, testMarker, safeVerifyCommand } from '@/lib/repo/live/policy'
import { compileContext, nextObservation } from '@/lib/repo/live/context'
import { useRepoSession } from '@/lib/repo/live/useRepoSession'
import { useRepoObserver } from '@/lib/repo/live/useObserver'
import { demoEvents, replayPrefix } from '@/lib/repo/live/fixtures'
import styles from './RepositoryWorkspace.module.css'
import { NativeCaptureControls } from './NativeCaptureControls'

type AudioSource = 'both' | 'system' | 'mic' | 'none'
export function RepositoryWorkspace({ replay = false }: { replay?: boolean }) {
  const call = useInterviewRecorder(), mic = useInterviewRecorder(), { keyterms } = useKeytermPrefs()
  const [running, setRunning] = useState(false), [consent, setConsent] = useState(false), [source, setSource] = useState<AudioSource>('system')
  const [task, setTask] = useState(''), [error, setError] = useState(''), [note, setNote] = useState(''), [exportConsent, setExportConsent] = useState(false)
  const [cursor, setCursor] = useState(0), [playing, setPlaying] = useState(false), [importedReplay, setImportedReplay] = useState(false)
  const beginAt = useRef(0), life = useRef(0), fileInput = useRef<HTMLInputElement>(null), folderInput = useRef<HTMLInputElement>(null), replayInput = useRef<HTMLInputElement>(null)
  const getCall = call.getSegments, getMic = mic.getSegments
  const questionText = useCallback(() => source === 'none' ? '' : detectionTranscript((source === 'mic' ? getMic() : getCall()).filter(v => v.capturedAt >= beginAt.current), source === 'both' ? getMic().filter(v => v.capturedAt >= beginAt.current) : []), [getCall, getMic, source])
  const engine = useRepoSession(questionText, running && !replay && !importedReplay)
  const observer = useRepoObserver(engine.observe)
  const state = engine.state
  const [fixture] = useState(demoEvents)
  const stopEngine = engine.stop, stopObserver = observer.stop, stopCall = call.stop, stopMic = mic.stop
  const requestStop = useCallback(() => { life.current++; stopEngine(); stopObserver(); setRunning(false); void stopCall(); void stopMic() }, [stopEngine, stopObserver, stopCall, stopMic])
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => {
    if (!running) return
    const guard = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [running])
  const replaceReplay = engine.replaceReplay
  useEffect(() => { if (replay && !importedReplay) replaceReplay(replayPrefix(fixture.events, cursor)) }, [replay, importedReplay, cursor, fixture.events, replaceReplay])
  useEffect(() => {
    if (!playing || importedReplay || cursor >= fixture.events.length) return
    const timer = setTimeout(() => setCursor(value => Math.min(value + 1, fixture.events.length)), 900)
    return () => clearTimeout(timer)
  }, [playing, importedReplay, cursor, fixture.events.length])

  async function start() {
    if (!consent || running) return
    if (source === 'none' && !task.trim()) { setError('Describe the task before starting a screen-only session.'); return }
    const token = ++life.current
    beginAt.current = Date.now(); engine.reset(); setError(''); setRunning(true)
    if (task.trim()) engine.question(task.trim())
    try {
      if (source === 'both' || source === 'system') await call.start('system', keyterms)
      if (token === life.current && (source === 'both' || source === 'mic')) await mic.start('mic', keyterms)
    } catch (e) { if (token === life.current) { requestStop(); setError(e instanceof Error ? e.message : 'Audio could not start') } }
  }
  async function importFolder(files: FileList | null) {
    if (!files || !running || !consent) return
    setError('')
    const token = life.current
    let bytes = 0, accepted = 0
    try {
      for (const file of Array.from(files).slice(0, 120)) {
        const path = file.webkitRelativePath ? file.webkitRelativePath.split('/').slice(1).join('/') : file.name
        if (!canImport(path)) continue
        bytes += file.size
        if (file.size > 150000 || bytes > 600000) throw new Error('Folder import exceeds the 600 KB source budget. Select a smaller relevant folder. Earlier accepted files remain visible.')
        const content = await file.text()
        if (token !== life.current) return
        const lines = content.split(/\r?\n/)
        if (lines.some(line => line.length > 2000)) continue
        const ext = path.split('.').at(-1)!
        for (let offset = 0; offset < lines.length; offset += 200) engine.observe({ files: [{ path, language: ext, startLine: offset + 1, lines: lines.slice(offset, offset + 200), confidence: 1, endOfFile: offset + 200 >= lines.length }], visiblePaths: [path], terminal: '', requirements: [] }, 'file-import')
        accepted++
      }
      if (!accepted) setError('No supported source files were found. Secret paths, dependencies and generated files are excluded.')
    } catch (e) { setError(e instanceof Error ? e.message : 'Folder import failed') }
    if (folderInput.current) folderInput.current.value = ''
  }
  async function loadReplay(file?: File) {
    if (!file) return
    try {
      if (file.size > 8000000) throw new Error('Replay must be under 8 MB.')
      const parsed = importSession(await file.text())
      requestStop(); setPlaying(false); setImportedReplay(true); replaceReplay(parsed); setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Invalid replay') }
    if (replayInput.current) replayInput.current.value = ''
  }
  function download() {
    if (!exportConsent) { setError('Review and confirm the export notice first.'); return }
    try {
      const url = URL.createObjectURL(new Blob([exportSession(state)], { type: 'application/json' }))
      const a = document.createElement('a'); a.href = url; a.download = 'repository-session-replay.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : 'Export failed') }
  }
  const next = state.navigation ?? nextObservation(state), compiled = compileContext(state), summaries = coverage(state)
  const hasSession = running || state.seq > 0 || replay || importedReplay, isReplay = replay || importedReplay
  const commands = (state.plan?.verify ?? []).filter(safeVerifyCommand)
  const verdict = (value: 'pass' | 'needs-work') => { engine.dispatch({ kind: 'feedback', data: { target: state.question?.id ?? 'session', verdict: value, note } }); setNote('') }
  function guardNavigation(event: React.MouseEvent<HTMLAnchorElement>) { if (running) { event.preventDefault(); setError('End this session before leaving. Evidence remains available until you leave the page.') } }
  return <WorkspaceShell active="repository" onNavigate={guardNavigation}>
    <main className={styles.page}>
      <header className={styles.header}><div><h1>{isReplay ? 'Repository Replay Lab' : 'Repository copilot'}</h1><p className={styles.subtitle}>{isReplay ? 'Replay observed events through the same state engine. No model requests or device capture.' : 'Say now. Look at the right file. Make a grounded change.'}</p></div><div className={styles.links}><Link href={replay ? '/interview/repository' : '/interview/replay'} onClick={guardNavigation}>{replay ? 'Open live workspace' : 'Open Replay Lab'}</Link><Link href="/copilot?mode=repoInterview&classic=1" onClick={guardNavigation}>Classic repository tools</Link></div></header>
      {!hasSession && <section className={styles.setup}>
        <h2>Keep talking while the code comes into focus.</h2><p>Share the permitted IDE window or import an authorized local repository. The copilot builds a partial, versioned code map, suggests what to inspect next, and checks the edits it can actually see.</p>
        <label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I have permission to record and share this session with AI services. External assistance is allowed for this interview or practice session.</span></label>
        <div className={styles.field}><span>Audio source</span><select aria-label="Repository audio source" className={styles.input} value={source} onChange={e => setSource(e.target.value as AudioSource)}><option value="system">Interviewer / system audio</option><option value="both">System audio + my microphone</option><option value="mic">Microphone (mock interviewer)</option><option value="none">Screen only — use the task below</option></select></div>
        <div className={styles.field}><label htmlFor="repo-task">Task or initial question (optional with audio)</label><textarea id="repo-task" className={styles.input} maxLength={2000} rows={3} value={task} onChange={e => setTask(e.target.value)} placeholder="What does the interviewer want changed?" /></div>
        <div className={styles.controls}><button className={`${styles.button} ${styles.primary}`} disabled={!consent} onClick={() => void start()}><Mic size={15} />Start session</button><Link className={styles.button} href="/interview/replay">Try the synthetic replay</Link></div>
        <p className={styles.subtitle}>Audio and screen sharing are separate choices. The app does not execute commands, submit solutions, or bypass assessment restrictions.</p>
      </section>}
      {hasSession && <>
        <div className={styles.bar}><strong><span className={styles.dot} />{isReplay ? 'Replay — no live inference' : running ? state.paused ? 'Guidance paused' : 'Live repository session' : 'Session ended'}</strong><small>Evidence r{state.evidenceRevision} · code r{state.codeRevision} · {summaries.length} files</small><div className={`${styles.controls} ${styles.right}`}>
          {!isReplay && running && <><button className={styles.button} onClick={() => engine.dispatch({ kind: 'pause', data: { paused: !state.paused } })}>{state.paused ? <Play size={14} /> : <Pause size={14} />}{state.paused ? 'Resume guidance' : 'Pause guidance'}</button><button className={`${styles.button} ${styles.stop}`} onClick={requestStop}><Square size={13} />End</button></>}
        </div></div>
        {isReplay && <section className={styles.notice}><strong>{importedReplay ? 'Imported event replay' : 'Synthetic example, not an AI-generated or real interview result.'}</strong><p>Replaying checks state transitions. It does not measure model quality or speech/screenshot accuracy.</p></section>}
        {replay && !importedReplay && <div className={styles.timeline}><button className={styles.button} onClick={() => { setCursor(0); setPlaying(false) }}><RotateCcw size={14} />Reset</button><button className={styles.button} disabled={cursor >= fixture.events.length} onClick={() => setCursor(v => Math.min(v + 1, fixture.events.length))}>Next event</button><button className={styles.button} disabled={cursor >= fixture.events.length} onClick={() => setPlaying(v => !v)}>{playing && cursor < fixture.events.length ? 'Pause replay' : 'Play replay'}</button><button className={styles.button} onClick={() => { setPlaying(false); setCursor(fixture.events.length) }}>Replay all</button><span className={styles.muted}>{cursor}/{fixture.events.length} events</span></div>}
        {!isReplay && running && <div className={styles.capture}>
          <NativeCaptureControls available={observer.nativeAvailable} displays={observer.displays} busy={observer.phase === 'requesting'} choose={observer.chooseNative} start={observer.beginNative} />
          {observer.phase === 'watching' && <button className={styles.button} disabled={observer.reading} onClick={observer.captureNow}>Capture now</button>}
          <button className={styles.button} onClick={() => void observer.start()} disabled={observer.phase === 'requesting' || observer.phase === 'watching'}><Monitor size={15} />{observer.phase === 'requesting' ? 'Select a surface…' : 'Share IDE'}</button>
          {(observer.phase === 'watching' || observer.phase === 'paused') && <button className={styles.button} onClick={observer.togglePause}>{observer.phase === 'paused' ? 'Resume capture' : 'Pause capture'}</button>}
          <button className={styles.button} disabled={observer.reading} onClick={() => fileInput.current?.click()}><Camera size={15} />Screenshot</button>
          <button className={styles.button} onClick={() => folderInput.current?.click()}><FolderOpen size={15} />Import folder</button>
          <span role="status" className={styles.progress}>{observer.reading ? 'Reading changed view…' : observer.phase === 'watching' ? 'Watching selected surface · local 5 Hz comparison' : 'Screen capture off'} · {observer.captures}/240 extraction requests</span>
        </div>}
        <input className={styles.hidden} ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload repository screenshot" onChange={e => { const file = e.target.files?.[0]; if (file && running && !isReplay) void observer.upload(file); e.target.value = '' }} />
        <input className={styles.hidden} ref={folderInput} type="file" multiple {...{ webkitdirectory: '' }} aria-label="Import authorized repository folder" onChange={e => void importFolder(e.target.files)} />
        {state.holdImplementation && <p className={styles.hold}>Implementation on hold: the interviewer asked to explain or plan before coding.</p>}
        <div className={styles.grid}>
          <div className={styles.main} data-testid="repo-answer-column">
            <section className={styles.card}><h2>Current question</h2><p className={styles.question}>{state.question?.text || 'Listening for the interviewer’s question…'}</p>{state.question && state.question.text !== state.question.raw && <details className={styles.details}><summary>Original transcript</summary><p className={styles.muted}>{state.question.raw}</p></details>}</section>
            <section className={`${styles.card} ${styles.say}`} aria-label="Say now"><h2>Say now {engine.busy.say && !isReplay ? '· streaming' : ''}</h2><p className={styles.sayText}>{engine.streamingSay || state.say?.text || 'Spoken guidance appears independently of the deeper code analysis.'}</p>{state.say && <p className={styles.subtitle}>{state.say.model}{state.say.firstTokenMs !== null && ` · first text ${(state.say.firstTokenMs / 1000).toFixed(2)}s after request`}</p>}</section>
            <section className={styles.card} aria-label="Navigation guidance"><h2>Look at</h2>{next ? <><p className={styles.path}>{next.path}{next.line !== null ? ` · line ${next.line}` : ''}</p>{next.symbol && <p className={styles.body}>{next.symbol}</p>}<p className={styles.muted}>{next.reason}</p>{state.navigation && <span className={styles.tag}>{state.navigation.status === 'observed' ? 'Target observed' : 'Waiting for the requested view'}</span>}</> : <p className={styles.muted}>{summaries.length ? 'Available file evidence is ready for analysis.' : 'Show the task and repository tree, then open the relevant entry point.'}</p>}</section>
            <section className={styles.card} aria-label="Change guidance"><h2>Change {engine.busy.plan && !isReplay ? '· analyzing' : ''}</h2><p className={styles.body}>{state.plan?.summary || 'Inspect the relevant files first. Exact changes require a visible, unique source anchor.'}</p>
              {state.edits.map(edit => <article key={edit.id} className={styles.edit}><div className={styles.editHeading}><p className={styles.path}>{edit.path} · observed line {edit.line}</p><span className={styles.tag}>{edit.status}</span></div><p className={styles.body}>{edit.reason}</p><details className={styles.details}><summary>Before → suggested replacement</summary><p className={styles.muted}>Before (observed)</p><pre className={styles.code}><code>{edit.before}</code></pre><p className={styles.muted}>After (suggested)</p><pre className={styles.code}><code>{edit.after}</code></pre></details><p className={`${styles.muted} ${edit.status === 'different' ? styles.warn : ''}`}>{edit.note}</p></article>)}
            </section>
            <section className={styles.card} aria-label="Code checks"><h2>Check {engine.busy.review && !isReplay ? '· reviewing' : ''}</h2>{state.plan?.checks.length ? <ul className={styles.list}>{state.plan.checks.map((check, i) => <li key={i}><strong>{check.severity}: </strong>{check.text}</li>)}</ul> : <p className={styles.muted}>A text match alone does not prove correctness. Different code can be an equivalent implementation.</p>}{state.plan?.missingEvidence.length ? <details className={styles.details} open><summary>Evidence still needed</summary><ul className={styles.list}>{state.plan.missingEvidence.map((v, i) => <li key={i}>{v}</li>)}</ul></details> : null}</section>
            <section className={styles.card} aria-label="Verification"><h2>Verify</h2><p className={styles.muted}>Run tests in your permitted IDE. Mark a run below, then print its unique marker on a separate line before the command. Only output after that marker can be associated with this code revision. No command runs here.</p>
              {commands.length ? commands.map((command, i) => <div key={i} className={styles.edit}><pre className={styles.code}><code>{command}</code></pre>{!isReplay && running && <button className={styles.button} onClick={() => engine.dispatch({ kind: 'test-start', data: { command } })}>Mark test started</button>}</div>) : <p className={styles.empty}>No targeted command has been established yet. Show the project’s build/test configuration.</p>}
              {state.testRuns.map(run => <div key={run.id} className={styles.edit}><p className={styles.body}><span className={styles.tag}>{run.status}</span> Code r{run.codeRevision}{run.passed !== null && ` · ${run.passed} passed`}{run.failed !== null && ` · ${run.failed} failed`} · screen-observed, not independently executed.</p>{run.status === 'waiting' && !isReplay && <><p className={styles.muted}>Print this marker, then run the selected command using your shell.</p><pre className={styles.code}><code>{`echo ${testMarker(run.id)}\n${run.command}`}</code></pre></>}</div>)}
            </section>
            {(isReplay || !running) && <section className={styles.card}><h2>Feedback & replay</h2><textarea aria-label="Repository feedback" className={styles.input} maxLength={2000} rows={3} placeholder="What was wrong, missing, or useful?" value={note} onChange={e => setNote(e.target.value)} /><div className={styles.controls}><button className={styles.button} onClick={() => verdict('pass')}>Pass</button><button className={styles.button} onClick={() => verdict('needs-work')}>Needs work</button></div><p className={styles.muted}>{state.feedback.length} feedback notes in this in-memory session.</p><div className={styles.feedback}><label className={styles.muted}><input type="checkbox" checked={exportConsent} onChange={e => setExportConsent(e.target.checked)} /> I reviewed this export. It contains source text and conversation events; remove confidential material before sharing.</label><div className={styles.controls}><button className={styles.button} disabled={!exportConsent} onClick={download}><Download size={14} />Export replay</button><button className={styles.button} onClick={() => replayInput.current?.click()}><Upload size={14} />Import replay</button></div></div></section>}
          </div>
          <aside className={styles.rail} aria-label="Repository evidence">
            <section className={styles.card}><h2>Observed repository ({summaries.length})</h2>{summaries.length ? summaries.map(file => <div key={file.path} className={styles.file}><p className={styles.path}><FileCode2 size={13} style={{ display: 'inline', marginRight: 6 }} />{file.path}</p><p className={styles.muted}>{file.observedLines} lines · {file.complete ? 'visible through EOF' : 'partial'}{file.hasConflicts ? ' · prior anchors retired' : ''}{file.uncertainLines ? ` · ${file.uncertainLines} uncertain` : ''}</p></div>) : <p className={styles.muted}>No file contents observed yet.</p>}<details className={styles.details}><summary>Context and request budget</summary><div className={styles.metric}><span>{compiled.characters.toLocaleString()} context characters</span><span>~{compiled.estimatedTokens.toLocaleString()} tokens (estimate)</span><span>{engine.requests}/120 model requests</span><span>{state.discardedResults} stale results discarded</span></div></details></section>
            {!!state.constraints.length && <section className={styles.card}><h2>Interview constraints</h2><ul className={styles.list}>{state.constraints.map(v => <li key={v}>{v}</li>)}</ul></section>}
            <section className={styles.card}><h2>Evidence, not assumptions</h2><p className={styles.muted}>Observed, suggested, changed, and tested are separate states. Unseen code stays unknown. Screen scores are not calibrated probabilities.</p></section>
          </aside>
        </div>
      </>}
      <input ref={replayInput} type="file" className={styles.hidden} accept="application/json" aria-label="Import repository replay" onChange={e => void loadReplay(e.target.files?.[0])} />
      <div className={styles.laneErrors}>{[error, observer.error, call.error, mic.error, ...Object.values(engine.errors)].filter(Boolean).map((message, i) => <p role="alert" className={styles.error} key={i}>{message}</p>)}</div>
      {!!Object.values(engine.errors).filter(Boolean).length && running && <button className={styles.button} onClick={engine.retry}>Retry analysis explicitly</button>}
      <footer className={styles.footer}><ShieldCheck size={13} style={{ display: 'inline', marginRight: 6 }} />Private in-memory workspace. Raw frames are not stored. Selected source, screenshots and audio go to configured services only when enabled. End stops capture and inference. No hidden IDE access, auto-submission, or test bypass.</footer>
    </main>
  </WorkspaceShell>
}
