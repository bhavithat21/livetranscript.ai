# Applies the reviewed local changes only to their exact source preimages.
# Temporary build transfer; not part of the application or final feature branch.
from pathlib import Path
import hashlib, os
ROOT = Path(os.environ['TARGET_ROOT']).resolve()
def put(name, old_hash, new_hash, operations):
    path = ROOT / name
    assert path.resolve().is_relative_to(ROOT), 'Invalid target path'
    old = path.read_bytes() if path.exists() else None
    assert (hashlib.sha256(old).hexdigest() if old is not None else None) == old_hash, 'Source mismatch: ' + name
    lines = (old.decode() if old is not None else '').splitlines(keepends=True)
    for start, end, content in reversed(operations):
        lines[start:end] = content.splitlines(keepends=True)
    data = ''.join(lines).encode()
    assert hashlib.sha256(data).hexdigest() == new_hash, 'Transfer mismatch: ' + name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(name, new_hash)

put('lib/coach/context.ts', '1e0daf768acd4dce07f72b265ea0e8939317407c7c5f955276f741d585daac54', 'a4f4c2f1ed3d0fd929252898fcb5b537503152bcac70b121624c4a068b52bd08', [
    (66, 66, r"""    visibleView: state.lastScreen ? {
      origin: state.sources.find(source => source.id === state.lastScreen!.sourceId)?.origin ?? 'screen',
      files: state.lastScreen.observation.files.map(file => ({ path: file.path, startLine: file.startLine, endLine: file.startLine === null ? null : file.startLine + file.lines.length - 1 })),
      terminalVisible: !!state.lastScreen.observation.terminal,
    } : null,
"""),
    (128, 129, r"""  const root = object(raw, ['schema', 'sessionId', 'permission', 'question', 'task', 'evidenceVersion', 'codeVersion', 'contextKey', 'files', 'knownPaths', 'relations', 'tests', 'patches', 'patchReviews', 'visibleView', 'budget'])
"""),
    (185, 185, r"""  let visibleView: ContextPacket['visibleView'] = null
  if (root.visibleView !== undefined && root.visibleView !== null) {
    const view = object(root.visibleView, ['origin', 'files', 'terminalVisible'])
    if (!['screen', 'file-import', 'replay'].includes(String(view.origin)) || typeof view.terminalVisible !== 'boolean') throw new Error('Invalid visible view')
    visibleView = {
      origin: view.origin as NonNullable<ContextPacket['visibleView']>['origin'], terminalVisible: view.terminalVisible,
      files: list(view.files, 12).map(value => {
        const item = object(value, ['path', 'startLine', 'endLine']), path = safePath(item.path)
        if (!knownPaths.includes(path)) throw new Error('Unobserved current-view path')
        const startLine = item.startLine === null ? null : integer(item.startLine, 1, 100_000)
        const endLine = item.endLine === null ? null : integer(item.endLine, 1, 100_000)
        if ((startLine === null) !== (endLine === null) || (startLine !== null && endLine! < startLine)) throw new Error('Invalid visible-view range')
        return { path, startLine, endLine }
      }),
    }
  }
"""),
    (187, 188, r"""    evidenceVersion: integer(root.evidenceVersion), codeVersion: integer(root.codeVersion), contextKey: text(root.contextKey, 100, true), files, knownPaths, relations, visibleView, tests, patches, patchReviews,
"""),
])
put('lib/coach/controller.ts', 'c499c50373179b09a302ab80591c0551f685b352d91685648f9d6424991f44f3', 'ccffbc12d67a1470fb0b8f194d006b617d885bd46a38ce2af8e74d1ee0822423', [
    (5, 5, r"""export type ReplayReference = { id: string; lane: string; model: string; text: string; summary: string; note: string; verdict: string }
"""),
    (21, 21, r"""  private replayEvents: CoachEvent[] = []
  private replayPosition = 0
  private replayReferences: ReplayReference[] = []
"""),
    (44, 45, r"""  task(objective: string, constraints: string[]) {
    if (this.state.status !== 'running' || this.disposed) return
    this.emit({ type: 'task.update', objective, constraints }); this.cancelStale()
    if (!this.replay) void this.run('talk')
    this.scheduleGuide()
  }
"""),
    (49, 50, r"""    if (this.state.evidenceVersion !== previous) {
      this.cancelStale()
      if (!this.replay) void this.run('talk')
      this.scheduleGuide()
    }
"""),
    (135, 136, r"""      evaluations: [...this.replayReferences.map(item => ({ ...item, referenceOnly: true })), ...this.state.results.filter(item => item.status !== 'running').map(item => ({ ...item }))], feedback: this.state.feedback,
"""),
    (155, 155, r"""    if (!events.length || events[0].type !== 'session.start') throw new Error('Replay must begin with an explicit practice/session start')
    const annotations = Array.isArray(root.evaluations) ? root.evaluations.slice(-80) : []
    const reviews = Array.isArray(root.feedback) ? root.feedback.slice(-100) : []
    // Reference-only annotations never enter state.files, buildContext or model
    // input. Keep the user's feedback visible when they reopen a replay.
    const references: ReplayReference[] = []
    for (const value of annotations) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const item = value as Record<string, unknown>
      if (typeof item.id !== 'string' || !['talk', 'guide', 'review'].includes(String(item.lane))) continue
      const review = reviews.findLast(value => value && typeof value === 'object' && (value as Record<string, unknown>).resultId === item.id) as Record<string, unknown> | undefined
      const guidance = item.guidance && typeof item.guidance === 'object' ? item.guidance as Record<string, unknown> : null
      const plain = (value: unknown, max: number) => typeof value === 'string' ? redactSecrets(value.slice(0, max)) : ''
      references.push({ id: plain(item.id, 100), lane: String(item.lane), model: plain(item.model, 180), text: plain(item.text, LIMITS.output), summary: plain(guidance?.summary ?? item.summary, 4000), note: plain(review?.note ?? item.note, 2000), verdict: plain(review?.verdict ?? item.verdict, 30) })
    }
    this.replayEvents = events.map(event => ({ ...event, sessionId: this.sessionId, ...(event.type === 'session.start' ? { permission: 'practice' as const } : {}) }))
    this.replayReferences = references
    this.seekReplay(events.length)
  }
  /** Seek uses only recorded source events up to the checkpoint. It never calls
   * a model and never lets future screenshots or old evaluations leak backward. */
  seekReplay(position: number) {
    if (!Number.isInteger(position) || position < 1 || position > this.replayEvents.length) throw new Error('Invalid replay checkpoint')
"""),
    (156, 158, r"""    let state = emptyCoach(this.sessionId)
    const events = this.replayEvents.slice(0, position)
    for (const event of events) state = reduceCoach(state, event)
    this.replayPosition = position; this.journal = events; this.journalSize = JSON.stringify(events).length; this.journalTruncated = false
    this.publish({ ...state, status: 'paused', warning: 'Replay checkpoint loaded offline. Saved model answers and review notes are reference only. Analyze explicitly to make new model calls.' })
"""),
    (159, 159, r"""  getReplayInfo() { return { position: this.replayPosition, total: this.replayEvents.length, event: this.replayEvents[this.replayPosition - 1]?.type ?? '', references: this.replayReferences } }
"""),
])
put('lib/coach/keyframes.ts', '93738402078b1a61ddacc1ddd5df782d9dec745dded2afe091b8ddd300b39935', '844ecc3082d825016c644d4a913340383dfb1b052560659c2cbdca4f5d02f593', [
    (14, 15, r"""    if (!Number.isFinite(now) || !Number.isInteger(signal.width) || !Number.isInteger(signal.height) || signal.width < 1 || signal.height < 1 || signal.width > 640 || signal.height > 640 || !signal.fingerprint || signal.width * signal.height !== signal.pixels.length) throw new Error('Invalid local frame signal')
"""),
    (19, 20, r"""    // A blinking caret must not reset the initial/changed-frame settle clock
    // forever. Allow at most two tiny changing tiles between local samples while
    // still detecting small persistent code edits against the accepted frame.
    // Returning exactly to the accepted frame above clears cursor-only changes.
    if (!this.candidate || changedTileCount(this.candidate, signal) > 2) this.candidateAt = now
    this.candidate = signal
"""),
])
put('lib/coach/prompts.ts', '31ca67e918495357abc4323f4822f213c24520cce773f186b9c15c538ae2640b', '5e59abd0c75cf7fc861c2c039af8c5be27026f37cd1bf9f846d6941bb570fe2b', [
    (7, 7, r"""visibleView describes the latest observed editor ranges, not hidden files. file-import is read source, not proof that the user has navigated to that editor. Do not repeatedly request a range already visible unless its text is uncertain.
"""),
])
put('lib/coach/screen.ts', '861001742c441e1be0816b1f140e5ac8e496abe7916cb6092fb887620cce73de', '009180e03644770facd8288f59ee381d6d076a98158574fd335fb077a5926aec', [
    (29, 30, r"""    const stopping = this.stop(), expectedGeneration = this.generation
    await stopping
    if (expectedGeneration !== this.generation) { await source.stop(); return }
"""),
    (49, 50, r"""          const capturedAt = Date.now(), image = await this.source.image()
"""),
    (89, 90, r"""    const generation = this.generation, capturedAt = Date.now(), image = await this.source?.image()
"""),
    (92, 93, r"""    return this.capture(image, capturedAt)
"""),
])
put('lib/coach/state.ts', '1bcf79f735bec195d566d2898c98aaf4eeeb5d9c72db5f26a39427390ed9e548', 'd922f9c641c9c59accfb6cb8ef9c51586c01b504195a9283587c0d37f8650cb3', [
    (0, 2, r"""import type { CoachState, CoachEvent, ObservedFile, Fragment, Observation, FileObservation, Navigation, PatchReview, Source, Task, EventPayload } from './types'
import { hashText, LIMITS, parseObservation, text, list, integer, permission, object } from './validation'
import { parseTestOutput } from './testOutput'
export { parseTestOutput } from './testOutput'
"""),
    (55, 56, r"""    contentKey: '' }
  // Chunk boundaries and provenance do not change code semantics. Overlapping
  // re-captures must not repeatedly invalidate caches or bill new investigations.
  file.contentKey = hashText(JSON.stringify({
    anchored: [...lineMap(file)].sort(([a], [b]) => a - b).map(([line, value]) => [line, value.text, value.confidence]),
    eof: fileCoverage(file).last,
    unanchored: [...new Set(fragments.filter(part => part.startLine === null).map(part => JSON.stringify([part.lines, part.confidence, part.endOfFile])))].sort(),
  }))
"""),
    (102, 113, r""""""),
    (115, 115, r"""  speech = speech.replaceAll('’', "'")
"""),
    (120, 121, r"""  const deferTests = 'Interviewer asked to defer tests. Do not claim the change is verified.'
  const resumeTests = /\b(?:now|please|go ahead and|okay[, ]+)\s*(?:run|add|write|execute)\s+(?:the |some |targeted )?tests\b/i.test(speech)
  const constraints = task.constraints.filter(value => !resumeTests || value !== deferTests)
"""),
    (123, 124, r"""  if (/\b(?:don't worry about|skip|do not run).{0,10}tests\b/i.test(speech)) constraints.push(deferTests)
  if (resumeTests) phase = 'review'
"""),
    (153, 154, r"""      return invalidate({ ...state, navigation: null, patches: [], patchReviews: [] })
"""),
    (170, 170, r"""      const lastSource = state.lastScreen && state.sources.find(item => item.id === state.lastScreen!.sourceId)
      // Extraction may finish out of order. An older image cannot overwrite the
      // current screen, code revision, terminal output, or navigation confirmation.
      if (lastSource && source.at < lastSource.at) return { ...state, warning: 'An older screenshot finished late and was ignored. Recapture it to use current evidence.' }
"""),
    (178, 179, r"""      const requirementsChanged = requirements.join('\n') !== state.task.requirements.join('\n')
      const viewKey = (view: Observation | undefined) => JSON.stringify(view?.files.map(file => [file.path, file.startLine, file.lines.length]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) ?? [])
      changed ||= knownPaths.length !== state.knownPaths.length || requirementsChanged || viewKey(observation) !== viewKey(state.lastScreen?.observation)

"""),
    (182, 183, r"""      state = { ...state, files: nextFiles, knownPaths, sources: [...state.sources, source].slice(-LIMITS.events), lastScreen: { sourceId: source.id, observation }, evidenceVersion: state.evidenceVersion + Number(changed), codeVersion: state.codeVersion + Number(edited), task: { ...state.task, requirements, version: state.task.version + Number(requirementsChanged) } }
"""),
])
put('lib/coach/testOutput.ts', None, '6e4918a10202dd75e95c46890b39e157ecbd261532c1d2e87c817f49865c6b46', [
    (0, 0, r"""import type { TestEvidence } from './types'
type Parsed = Pick<TestEvidence, 'status' | 'passed' | 'failed'>

/** Observed output only, never proof that we ran a process. Counts from different
 * test runs are never added together. An incomplete NEW run invalidates an older
 * passing summary still visible above it in terminal scrollback.
 */
export function parseTestOutput(output: string): Parsed {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, '').replaceAll('\r', '').split('\n')
  let result: Parsed = { status: 'incomplete', passed: null, failed: null }
  let tap: { passed: number | null; failed: number | null } | null = null
  let pythonCount: number | null = null
  let failedSinceStart = false
  const number = (value: string) => Math.min(1_000_000, Number(value))
  const summary = (passed: number | null, failed: number | null): Parsed => {
    if ((failed ?? 0) > 0) failedSinceStart = true
    return { status: (failed ?? 0) > 0 ? 'observed-fail' : (passed ?? 0) > 0 && (failed ?? 0) === 0 ? 'observed-pass' : 'incomplete', passed, failed }
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (/^(?:Running tests|collecting\b|RUN\s+v\d|Test run for|TAP version|>\s+\S.*\btest\b|\[INFO\]\s+Running\s+)/i.test(line)) {
      result = { status: 'running', passed: null, failed: null }; tap = null; pythonCount = null; failedSinceStart = false
    }
    const tapPassed = line.match(/^# pass (\d+)$/), tapFailed = line.match(/^# fail (\d+)$/)
    if (tapPassed || tapFailed) {
      if (!tap || (tapPassed && tap.passed !== null)) tap = { passed: null, failed: null }
      if (tapPassed) tap.passed = number(tapPassed[1])
      if (tapFailed) tap.failed = number(tapFailed[1])
      result = tap.passed !== null && tap.failed !== null ? summary(tap.passed, tap.failed) : { status: 'incomplete', ...tap }
      continue
    }
    // dotnet test: 'Passed! - Failed: 0, Passed: 27, Skipped: 0, Total: 27'
    const dotnet = line.match(/^(?:Passed!|Failed!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+)/i)
    if (dotnet) { result = summary(number(dotnet[2]), number(dotnet[1])); continue }
    // Maven/Surefire summary may contain errors separately from failed assertions.
    const maven = line.match(/^(?:\[(?:INFO|ERROR)\]\s*)?Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+),\s*Skipped:\s*(\d+)/i)
    if (maven) {
      const [total, failures, errors, skipped] = maven.slice(1).map(number)
      result = failures + errors + skipped <= total ? summary(total - failures - errors - skipped, failures + errors) : { status: 'incomplete', passed: null, failed: null }
      continue
    }
    const junit = line.match(/^OK\s*\((\d+) tests?\)$/)
    if (junit) { result = summary(number(junit[1]), 0); continue }
    const ran = line.match(/^Ran (\d+) tests? in /)
    if (ran) { pythonCount = number(ran[1]); result = { status: 'running', passed: null, failed: null }; continue }
    if (line === 'OK') { result = pythonCount === null ? { status: 'incomplete', passed: null, failed: null } : summary(pythonCount, 0); continue }
    const go = line.match(/^ok\s+\S+\s+(?:[\d.]+s|\(cached\))$/)
    if (go) { result = { status: 'observed-pass', passed: null, failed: null }; continue }
    // Jest/Vitest, pytest and Rust test-run summaries; plain '10 passed' is
    // deliberately not enough to conclude a test run has finished.
    if (/^(?:Tests:?\s+|=+|test result:\s+)/i.test(line) && /\b(?:passed|failed)\b/.test(line)) {
      const passed = line.match(/(\d+)\s+passed\b/), failed = line.match(/(\d+)\s+failed\b/)
      const errors = line.match(/(\d+)\s+errors?\b/)
      result = summary(passed ? number(passed[1]) : null, (failed ? number(failed[1]) : 0) + (errors ? number(errors[1]) : 0))
      continue
    }
    if (/^(?:FAIL(?:\s|$)|FAILURES!!!|FAILED(?:\s|\s*\()|error (?:TS|CS)\d+|Compilation failure|BUILD FAILED|\[ERROR\].*BUILD FAILURE)/i.test(line)) {
      failedSinceStart = true
      result = { ...result, status: 'observed-fail' }
    }
  }
  // A later passing package cannot erase an earlier failure in the same run.
  // Do not combine incompatible package counts into a made-up total.
  return failedSinceStart && result.status !== 'observed-fail'
    ? { status: 'observed-fail', passed: null, failed: null } : result
}
"""),
])
