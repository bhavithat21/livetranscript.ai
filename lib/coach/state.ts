import type { CoachState, CoachEvent, ObservedFile, Fragment, Observation, FileObservation, Navigation, PatchReview, Source, Task, EventPayload } from './types'
import { hashText, LIMITS, parseObservation, text, list, integer, permission, object } from './validation'
import { parseDialogueTurn, updateDialogue } from './dialogue'
import { projectRequirements, updateRequirementInputs } from './requirements'
import { parseTestOutput } from './testOutput'
export { parseTestOutput } from './testOutput'

export function emptyCoach(sessionId: string): CoachState {
  return { schema: 1, sessionId: text(sessionId, 100, true), permission: null, status: 'idle',
    task: { objective: '', requirements: [], constraints: [], phase: 'understand', implementation: 'allowed', version: 0 },
    evidenceVersion: 0, codeVersion: 0, sequence: 0, files: [], knownPaths: [], sources: [], lastScreen: null,
    question: null, questions: [], navigation: null, patches: [], patchReviews: [], tests: [], results: [], feedback: [], seenEvents: [], warning: null }
}
export function lineMap(file: ObservedFile): Map<number, { text: string; confidence: number; sources: string[] }> {
  const result = new Map<number, { text: string; confidence: number; sources: string[] }>()
  for (const fragment of file.fragments) if (fragment.startLine !== null) fragment.lines.forEach((text, index) => {
    const number = fragment.startLine! + index, old = result.get(number)
    result.set(number, { text, confidence: Math.max(fragment.confidence, old?.text === text ? old.confidence : 0), sources: [...new Set([...(old?.text === text ? old.sources : []), ...fragment.sources])] })
  })
  return result
}
export function fileCoverage(file: ObservedFile) {
  const lines = lineMap(file), ends = file.fragments.filter(part => part.endOfFile && part.startLine !== null).map(part => part.startLine! + part.lines.length - 1)
  const last = ends.length ? Math.max(...ends) : null
  const ranges: Array<{ start: number; end: number }> = []
  for (const number of [...lines.keys()].sort((a, b) => a - b)) {
    const previous = ranges.at(-1)
    if (previous && previous.end + 1 === number) previous.end = number
    else ranges.push({ start: number, end: number })
  }
  const uncertain = [...lines.values()].filter(line => line.confidence < 0.9).length
  const unanchored = file.fragments.filter(part => part.startLine === null).reduce((sum, part) => sum + part.lines.length, 0)
  const complete = last !== null && ranges.length === 1 && ranges[0].start === 1 && ranges[0].end === last && !uncertain && !unanchored
  return { ranges, last, uncertain, unanchored, complete, observed: lines.size + unanchored }
}
function mergeFile(previous: ObservedFile | undefined, observed: FileObservation, source: Source): { file: ObservedFile; edited: boolean; changed: boolean } {
  const old: ObservedFile = previous ?? { path: observed.path, language: observed.language, version: 1, fragments: [], retired: [], contentKey: '', lastSeen: source.sequence }
  const anchors = lineMap(old)
  const oldEnd = fileCoverage(old).last
  const overlapChanged = observed.startLine !== null && observed.lines.some((line, index) => anchors.has(observed.startLine! + index) && anchors.get(observed.startLine! + index)!.text !== line)
  const extentChanged = observed.startLine !== null && ((oldEnd !== null && observed.startLine + observed.lines.length - 1 > oldEnd) || (observed.endOfFile && [...anchors.keys()].some(line => line >= observed.startLine! + observed.lines.length)))
  // New unanchored text cannot safely be stitched into old line positions.
  const unanchoredChanged = observed.startLine === null && old.fragments.length > 0 && !old.fragments.some(part => part.startLine === null && part.lines.join('\n') === observed.lines.join('\n'))
  const edited = overlapChanged || extentChanged || unanchoredChanged
  const retired = edited ? [...old.retired, { version: old.version, sources: [...new Set(old.fragments.flatMap(part => part.sources))], reason: 'Conflicting text or extent: all old anchors retired' }].slice(-8) : old.retired
  let fragments = edited ? [] : old.fragments.slice()
  const duplicate = fragments.findIndex(part => part.startLine === observed.startLine && part.endOfFile === observed.endOfFile && part.lines.join('\n') === observed.lines.join('\n'))
  const next: Fragment = { ...observed, lines: observed.lines.slice(), sources: [source.id] }
  if (duplicate >= 0) {
    next.confidence = Math.max(next.confidence, fragments[duplicate].confidence)
    next.sources = [...new Set([...fragments[duplicate].sources, source.id])].slice(-12)
    fragments.splice(duplicate, 1)
  }
  fragments.push(next)
  if (fragments.length > LIMITS.fragments) {
    fragments = compactFragments(fragments)
    if (fragments.length > LIMITS.fragments) throw new Error('This file has too many partial observations. Import or recapture the current file from line 1.')
  }
  const file: ObservedFile = { ...old, language: observed.language, version: old.version + Number(edited), fragments, retired, lastSeen: source.sequence,
    contentKey: '' }
  // Chunk boundaries and provenance do not change code semantics. Overlapping
  // re-captures must not repeatedly invalidate caches or bill new investigations.
  file.contentKey = hashText(JSON.stringify({
    anchored: [...lineMap(file)].sort(([a], [b]) => a - b).map(([line, value]) => [line, value.text, value.confidence]),
    eof: fileCoverage(file).last,
    unanchored: [...new Set(fragments.filter(part => part.startLine === null).map(part => JSON.stringify([part.lines, part.confidence, part.endOfFile])))].sort(),
  }))
  return { file, edited, changed: file.contentKey !== old.contentKey }
}
function compactFragments(fragments: Fragment[]): Fragment[] {
  const map = lineMap({ path: '', language: '', version: 1, fragments, retired: [], contentKey: '', lastSeen: 0 })
  const end = Math.max(0, ...fragments.filter(part => part.endOfFile && part.startLine !== null).map(part => part.startLine! + part.lines.length - 1))
  const result = fragments.filter(part => part.startLine === null)
  for (const [number, line] of [...map.entries()].sort(([a], [b]) => a - b)) {
    const last = result.at(-1)
    if (last && last.startLine !== null && last.startLine + last.lines.length === number && last.confidence === line.confidence && last.sources.join('|') === line.sources.join('|') && last.lines.length < 240) {
      last.lines.push(line.text); last.endOfFile = number === end
    } else result.push({ path: fragments[0].path, language: fragments[0].language, startLine: number, lines: [line.text], confidence: line.confidence, endOfFile: number === end, sources: [...line.sources] })
  }
  return result
}
export function navigationSeen(nav: Navigation, observation: Observation): boolean {
  return observation.files.some(file => {
    if (file.path !== nav.path || file.confidence < 0.9) return false
    if (nav.symbol && !file.lines.some(line => new RegExp(`\\b${nav.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(line))) return false
    if (nav.startLine !== null && (file.startLine === null || nav.startLine < file.startLine || (nav.endLine ?? nav.startLine) >= file.startLine + file.lines.length)) return false
    return true
  })
}
export function reviewEdits(state: CoachState): PatchReview[] {
  return state.patches.map(patch => {
    const file = state.files.find(item => item.path === patch.path)
    if (!file || !state.lastScreen?.observation.files.some(item => item.path === patch.path)) return state.patchReviews.find(item => item.patchId === patch.id) ?? { patchId: patch.id, status: 'not-observed', detail: 'Show this file after making the edit.', observedSource: null }
    const map = lineMap(file), after = patch.after.split('\n'), before = patch.before.split('\n')
    // Exact text matching is not proof of semantic correctness.
    const read = (count: number) => Array.from({ length: count }, (_, i) => map.get(patch.startLine + i))
    const candidate = read(Math.max(after.length, before.length))
    const sourceId = state.lastScreen.sourceId
    const uncertain = candidate.some(item => !item || item.confidence < 0.9)
    const afterRows = read(after.length)
    const isAfter = patch.after.length > 0 && afterRows.every((item, i) => item && item.confidence >= 0.9 && item.text === after[i])
    if (isAfter && file.version > patch.fileVersion) return { patchId: patch.id, status: 'matches-proposal', detail: 'Observed text matches the suggested replacement. Tests are still required.', observedSource: sourceId }
    const isBefore = read(before.length).every((item, i) => item && item.confidence >= 0.9 && item.text === before[i])
    if (isBefore) {
      const wasApplied = state.patchReviews.find(item => item.patchId === patch.id)?.status === 'matches-proposal'
      return { patchId: patch.id, status: wasApplied ? 'reverted' : 'not-observed', detail: wasApplied ? 'The previous code is visible again; the proposal appears reverted.' : 'The pre-edit code is still visible.', observedSource: sourceId }
    }
    if (uncertain || !patch.after) return { patchId: patch.id, status: 'incomplete', detail: 'Insufficient clear, anchored text to verify this edit. Recapture with overlap.', observedSource: sourceId }
    const observed = candidate.map(item => item!.text).join('\n')
    const operatorWarning = patch.after.includes('&&') && observed.includes('||') ? 'An OR (||) is visible where the proposal uses AND (&&); check the intended condition.' : patch.after.includes('||') && observed.includes('&&') ? 'An AND (&&) is visible where the proposal uses OR (||); check the intended condition.' : 'Observed text differs from the proposal. It may be an equivalent implementation; review before treating it as wrong.'
    return { patchId: patch.id, status: 'differs', detail: operatorWarning, observedSource: sourceId }
  })
}
export function intentFromSpeech(task: Task, speech: string): Task {
  // Only finalized interviewer speech enters this path, never source comments.
  speech = speech.replaceAll('’', "'")
  let phase = task.phase, implementation = task.implementation
  if (/\b(?:do not|don't|not yet|before you)\s+(?:start\s+)?(?:code|implement|modify)\b|\b(?:explain|walk me through).{0,35}(?:first|before coding)\b/i.test(speech)) { phase = 'plan'; implementation = 'hold' }
  else if (/\b(?:go ahead and|okay[, ]+|now |please )\s*(?:implement|code|make the change|start coding)\b/i.test(speech)) { phase = 'implement'; implementation = 'allowed' }
  else if (/\b(?:debug|why.{0,15}fail|fix the (?:bug|test))\b/i.test(speech)) phase = 'debug'
  else if (/\b(?:review|improve|clean up)\b/i.test(speech)) phase = 'review'
  const deferTests = 'Interviewer asked to defer tests. Do not claim the change is verified.'
  const resumeTests = /\b(?:now|please|go ahead and|okay[, ]+)\s*(?:run|add|write|execute)\s+(?:the |some |targeted )?tests\b/i.test(speech)
  const constraints = task.constraints.filter(value => !resumeTests || value !== deferTests)
  if (/\b(?:don't|do not|no)\s+(?:change|modify|alter).{0,15}(?:api|signature|interface)\b/i.test(speech)) constraints.push('Keep public APIs and signatures unchanged.')
  if (/\b(?:no external|without (?:new|external)|don't (?:use|add)).{0,20}(?:librar|dependenc)/i.test(speech)) constraints.push('Do not add external dependencies.')
  if (/\b(?:don't worry about|skip|do not run).{0,10}tests\b/i.test(speech)) constraints.push(deferTests)
  if (resumeTests) phase = 'review'
  const next = { ...task, phase, implementation, constraints: [...new Set(constraints)].slice(-30) }
  return JSON.stringify(next) === JSON.stringify(task) ? task : { ...next, version: task.version + 1 }
}
export function normalizeQuestion(value: string): string {
  // Preserve negation, technical names and original utterance; do not guess at ASR.
  return value.trim().replace(/^(?:(?:interviewer|speaker\s*\d+|call)\s*:\s*)+/i, '').replace(/^(?:(?:um|uh|okay|so)[, ]+)+/i, '').replace(/\s+/g, ' ').slice(0, 2000)
}
export function resultCurrent(result: CoachState['results'][number], state: CoachState): boolean {
  return result.questionId === state.question?.id && (result.lane === 'talk' ? result.codeVersion === state.codeVersion && result.taskVersion === state.task.version : result.evidenceVersion === state.evidenceVersion)
}
function invalidate(state: CoachState): CoachState {
  return { ...state, results: state.results.map(result => !resultCurrent(result, state) && result.status !== 'failed' && result.status !== 'cancelled' ? { ...result, status: 'stale' } : result) }
}
export function reduceCoach(previous: CoachState, event: CoachEvent): CoachState {
  if (event.sessionId !== previous.sessionId) throw new Error('Cross-session event rejected')
  text(event.id, 100, true); integer(event.at)
  if (previous.seenEvents.includes(event.id)) return previous
  if (previous.status === 'ended' && event.type !== 'feedback.add') return previous
  let state: CoachState = { ...previous, sequence: previous.sequence + 1, seenEvents: [...previous.seenEvents, event.id].slice(-LIMITS.events) }
  if (event.type === 'session.start') {
    if (state.status !== 'idle') throw new Error('Session already started')
    return { ...state, status: 'running', permission: permission(event.permission), task: { ...state.task, objective: text(event.objective, 4000, true), version: 1 } }
  }
  if (event.type === 'session.pause' || event.type === 'session.end') return { ...state, status: event.type === 'session.end' ? 'ended' : 'paused', results: state.results.map(item => item.status === 'running' ? { ...item, status: 'cancelled' } : item) }
  if (event.type === 'session.resume') { if (state.status !== 'paused') return previous; return { ...state, status: 'running' } }
  if (!state.permission) throw new Error('Start a permitted session before adding evidence')
  switch (event.type) {
    case 'task.update':
      state = { ...state, task: { ...state.task, objective: text(event.objective, 4000, true), constraints: list(event.constraints, 30).map(item => text(item, 1000, true)), version: state.task.version + 1 }, evidenceVersion: state.evidenceVersion + 1 }
      return invalidate({ ...state, navigation: null, patches: [], patchReviews: [] })
    case 'dialogue.update': {
      const conversation = updateDialogue(state.conversation ?? [], event.turn)
      return conversation === previous.conversation ? previous : { ...state, conversation }
    }
    case 'requirement.update': {
      const inputs = updateRequirementInputs(state.requirementInputs ?? [], event.turn)
      if (inputs === state.requirementInputs) return previous
      const { active, pending } = projectRequirements(inputs)
      const changed = JSON.stringify([active.map(r => r.text), pending.map(r => r.text)]) !== JSON.stringify([(state.task.spokenRequirements ?? []).map(r => r.text), (state.task.requirementClarifications ?? []).map(r => r.text)])
      if (!changed) return { ...state, requirementInputs: inputs }
      const task = { ...state.task, spokenRequirements: active, requirementClarifications: pending, version: state.task.version + 1 }
      // Changed requirements invalidate proposals/navigation, NOT observed code.
      return invalidate({ ...state, requirementInputs: inputs, task, evidenceVersion: state.evidenceVersion + 1, navigation: null, patches: [], patchReviews: [],
        tests: state.tests.map(run => ({ ...run, status: 'stale' as const })) })
    }
    case 'speech.final': {
      if (event.speaker !== 'interviewer') return state
      const task = intentFromSpeech(state.task, text(event.text, 4000))
      if (task === state.task) return state
      return invalidate({ ...state, task, evidenceVersion: state.evidenceVersion + 1 })
    }
    case 'question.new': {
      const value = normalizeQuestion(text(event.text, 2000, true))
      if (value.toLowerCase().replace(/[?!.]+$/, '') === state.question?.text.toLowerCase().replace(/[?!.]+$/, '')) return previous
      const question = { id: event.id, original: text(event.original, 4000, true), text: value, at: event.at }
      return { ...state, question, questions: [...state.questions, question].slice(-80), results: state.results.map(item => item.status === 'running' ? { ...item, status: 'cancelled' } : item), navigation: null }
    }
    case 'screen.observed': {
      const observation = parseObservation(event.observation)
      if (!['screen', 'file-import', 'replay'].includes(event.origin)) throw new Error('Invalid evidence origin')
      const source: Source = { id: event.id, at: event.capturedAt === undefined ? event.at : integer(event.capturedAt, 0, event.at), origin: event.origin, sequence: state.sequence }
      const lastSource = state.lastScreen && state.sources.find(item => item.id === state.lastScreen!.sourceId)
      // Extraction may finish out of order. An older image cannot overwrite the
      // current screen, code revision, terminal output, or navigation confirmation.
      if (lastSource && source.at < lastSource.at) return { ...state, warning: 'An older screenshot finished late and was ignored. Recapture it to use current evidence.' }
      const files = new Map(state.files.map(file => [file.path, file]))
      let edited = false, changed = false
      for (const observed of observation.files) { const next = mergeFile(files.get(observed.path), observed, source); files.set(observed.path, next.file); edited ||= next.edited; changed ||= next.changed }
      const knownPaths = [...new Set([...state.knownPaths, ...observation.visiblePaths, ...observation.files.map(file => file.path)])]
      if (knownPaths.length > LIMITS.paths || files.size > LIMITS.files) throw new Error('Repository observation capacity reached. Start a narrower session.')
      const nextFiles = [...files.values()]
      if (nextFiles.reduce((sum, file) => sum + JSON.stringify(file).length, 0) > LIMITS.sourceText) throw new Error('Repository text budget reached. Start a narrower session.')
      const requirements = [...new Set([...state.task.requirements, ...observation.requirements])].slice(-50)
      const requirementsChanged = requirements.join('\n') !== state.task.requirements.join('\n')
      const viewKey = (view: Observation | undefined) => JSON.stringify(view?.files.map(file => [file.path, file.startLine, file.lines.length]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) ?? [])
      changed ||= knownPaths.length !== state.knownPaths.length || requirementsChanged || viewKey(observation) !== viewKey(state.lastScreen?.observation)

      const oldTerminal = state.lastScreen?.observation.terminal || state.tests.at(-1)?.output || ''
      const terminalChanged = !!observation.terminal && observation.terminal !== oldTerminal
      changed ||= terminalChanged
      state = { ...state, files: nextFiles, knownPaths, sources: [...state.sources, source].slice(-LIMITS.events), lastScreen: { sourceId: source.id, observation }, evidenceVersion: state.evidenceVersion + Number(changed), codeVersion: state.codeVersion + Number(edited), task: { ...state.task, requirements, version: state.task.version + Number(requirementsChanged) } }
      if (event.origin !== 'file-import' && state.navigation && navigationSeen(state.navigation, observation)) state.navigation = { ...state.navigation, status: 'seen' }
      state.patchReviews = reviewEdits(state)
      if (edited) state.tests = state.tests.map(run => run.codeVersion !== null && run.codeVersion !== state.codeVersion ? { ...run, status: 'stale' } : run)
      if (terminalChanged) {
        const parsed = parseTestOutput(observation.terminal)
        const active = [...state.tests].reverse().find(run => run.codeVersion === state.codeVersion && run.startedAfter !== null && run.startedAfter < state.sequence && run.startedAt !== null && source.at >= run.startedAt && ['awaiting-output', 'running', 'incomplete'].includes(run.status) && observation.terminal !== run.outputBefore)
        if (active) state.tests = state.tests.map(run => run.id === active.id ? { ...run, ...parsed, sourceId: source.id, output: observation.terminal } : run)
        else state.tests = [...state.tests, { id: event.id, codeVersion: null, startedAfter: null, startedAt: null, command: '', ...parsed, sourceId: source.id, output: observation.terminal, outputBefore: '' }].slice(-20)
      }
      return changed ? invalidate(state) : state
    }
    case 'test.start':
      return { ...state, tests: [...state.tests, { id: event.id, codeVersion: state.codeVersion, startedAfter: state.sequence, startedAt: event.at, command: text(event.command, 500, true), status: 'awaiting-output' as const, passed: null, failed: null, sourceId: null, output: '', outputBefore: state.lastScreen?.observation.terminal || state.tests.at(-1)?.output || '' }].slice(-20) }
    case 'result.start':
      if (state.status !== 'running' || event.questionId !== state.question?.id || event.evidenceVersion !== state.evidenceVersion) return previous
      if (state.results.some(item => item.id === event.requestId)) return previous
      return { ...state, results: [...state.results, { id: text(event.requestId, 100, true), lane: event.lane, questionId: event.questionId, evidenceVersion: event.evidenceVersion, contextKey: event.contextKey, codeVersion: state.codeVersion, taskVersion: state.task.version, status: 'running' as const, text: '', guidance: null, model: '', startedAt: event.at, firstUsefulMs: null, totalMs: null, error: null }].slice(-80) }
    case 'result.delta':
      return { ...state, results: state.results.map(result => {
        if (result.id !== event.requestId || result.status !== 'running' || result.questionId !== state.question?.id || !resultCurrent(result, state) || state.status !== 'running') return result
        const value = result.text + text(event.text, 8000)
        if (value.length > LIMITS.output) throw new Error('Answer exceeds its output budget')
        return { ...result, text: value, model: text(event.model, 180), firstUsefulMs: result.firstUsefulMs ?? (value.trim().length > 0 ? Math.max(0, event.at - result.startedAt) : null) }
      }) }
    case 'result.complete': {
      const result = state.results.find(item => item.id === event.requestId)
      if (!result || result.status !== 'running' || result.questionId !== state.question?.id || !resultCurrent(result, state) || state.status !== 'running') return previous
      state.results = state.results.map(item => item === result ? { ...item, status: 'complete', guidance: event.guidance, model: text(event.model, 180), totalMs: Math.max(0, event.at - item.startedAt) } : item)
      if (event.guidance && result.lane !== 'talk') {
        const first = event.guidance.look[0]
        state.navigation = first ? { ...first, status: 'pending', requestedAfter: state.sequence } : null
        if (state.navigation && state.lastScreen && state.sources.find(item => item.id === state.lastScreen!.sourceId)?.origin !== 'file-import' && navigationSeen(state.navigation, state.lastScreen.observation)) state.navigation.status = 'seen'
        state.patches = event.guidance.patches.length ? event.guidance.patches : state.patches
        state.patchReviews = reviewEdits(state)
      }
      return state
    }
    case 'result.fail':
      return { ...state, results: state.results.map(item => item.id === event.requestId && item.status === 'running' ? { ...item, status: event.cancelled ? 'cancelled' : 'failed', error: text(event.error, 500), totalMs: Math.max(0, event.at - item.startedAt) } : item) }
    case 'feedback.add':
      if (!state.results.some(result => result.id === event.resultId)) throw new Error('Feedback target does not exist')
      if (!['pass', 'needs-work'].includes(event.verdict)) throw new Error('Invalid feedback')
      return { ...state, feedback: [...state.feedback, { id: event.id, resultId: event.resultId, verdict: event.verdict, categories: list(event.categories, 8).map(value => text(value, 80)), note: text(event.note, 2000), at: event.at }].slice(-100) }
  }
}
export function parseReplayEvent(raw: unknown): CoachEvent {
  const item = object(raw)
  const base = { id: text(item.id, 100, true), at: integer(item.at), sessionId: text(item.sessionId, 100, true) }
  let payload: EventPayload
  switch (item.type) {
    case 'session.start': payload = { type: item.type, permission: permission(item.permission), objective: text(item.objective, 4000, true) }; break
    case 'session.pause': case 'session.resume': case 'session.end': payload = { type: item.type }; break
    case 'task.update': payload = { type: item.type, objective: text(item.objective, 4000, true), constraints: list(item.constraints, 30).map(value => text(value, 1000, true)) }; break
    case 'speech.final': if (!['interviewer', 'candidate'].includes(String(item.speaker))) throw new Error('Invalid replay speaker'); payload = { type: item.type, speaker: item.speaker as 'interviewer' | 'candidate', text: text(item.text, 4000) }; break
    case 'requirement.update': payload = { type: item.type, turn: parseDialogueTurn(item.turn) }; break
    case 'dialogue.update': payload = { type: item.type, turn: parseDialogueTurn(item.turn) }; break
    case 'question.new': payload = { type: item.type, original: text(item.original, 4000, true), text: text(item.text, 2000, true) }; break
    case 'screen.observed': payload = { type: item.type, origin: item.origin === 'file-import' ? 'file-import' : 'replay', observation: parseObservation(item.observation), ...(item.capturedAt === undefined ? {} : { capturedAt: integer(item.capturedAt, 0, base.at) }) }; break
    case 'test.start': payload = { type: item.type, command: text(item.command, 500, true) }; break
    default: throw new Error('Replay can only import observations and session actions; model outputs are not evidence')
  }
  return { ...base, ...payload }
}
