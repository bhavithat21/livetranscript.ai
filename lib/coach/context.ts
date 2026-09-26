import type { CoachState, ContextPacket, ObservedFile, Fragment, EvidenceRef, Navigation, Task, TestEvidence, Patch, PatchReview } from './types'
import type { SpokenRequirement } from './requirements'
import { dialogueContext, parseDialogueTurn } from './dialogue'
import { fileCoverage } from './state'
import { hashText, integer, LIMITS, list, object, parseObservation, permission, safePath, text } from './validation'

const STOP = new Set(['the', 'this', 'that', 'with', 'what', 'which', 'would', 'could', 'should', 'from', 'have', 'file', 'about', 'into', 'your', 'please'])
function terms(value: string): string[] { return [...new Set(value.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? [])].filter(value => !STOP.has(value)).slice(0, 60) }
function stem(path: string): string { return path.split('/').at(-1)!.replace(/\.[^.]+$/, '') }
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Bounded lexical symbol/reference cache. These references are NOT a proven call graph. */
export class EvidenceIndex {
  private cache = new Map<string, { content: string; symbols: string[] }>()
  summarize(file: ObservedFile) {
    const key = `${file.path}:${file.version}:${file.contentKey}`
    const found = this.cache.get(key)
    if (found) return found
    const content = file.fragments.map(part => part.lines.join('\n')).join('\n')
    const symbols = [...new Set([...content.matchAll(/\b(?:class|interface|function|def|func|struct|enum)\s+([A-Za-z_]\w*)/g)].map(match => match[1]))].slice(0, 60)
    const value = { content, symbols }
    for (const old of this.cache.keys()) if (old.startsWith(`${file.path}:`)) this.cache.delete(old)
    this.cache.set(key, value)
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!)
    return value
  }
  clear() { this.cache.clear() }
}
export function rankFiles(state: CoachState, index = new EvidenceIndex()) {
  const query = terms(`${(state.task.spokenRequirements ?? []).map(r => r.text).join(' ')} ${state.question?.text ?? ''} ${state.task.objective}`)
  const current = new Set(state.lastScreen?.observation.files.map(item => item.path) ?? [])
  const failures = state.tests.filter(run => run.status === 'observed-fail' && (run.codeVersion === null || run.codeVersion === state.codeVersion)).map(run => run.output).join('\n')
  const nodes = state.knownPaths.map(path => {
    const file = state.files.find(file => file.path === path), summary = file ? index.summarize(file) : { content: '', symbols: [] }
    const score = query.reduce((sum, term) => sum + (path.toLowerCase().includes(term) ? 12 : 0) + (summary.content.toLowerCase().includes(term) ? 2 : 0), 0)
      + (current.has(path) ? 8 : 0) + (failures.includes(path) || (stem(path).length > 3 && failures.includes(stem(path))) ? 20 : 0)
    return { path, file, content: summary.content, score }
  })
  const relations: ContextPacket['relations'] = []
  for (const from of nodes.filter(node => node.file)) for (const to of nodes) {
    if (from.path === to.path || stem(to.path).length < 3) continue
    const name = stem(to.path), pattern = new RegExp(`(?:\\b${escape(name)}\\b|["'](?:[^"']*/)?${escape(name)}(?:\\.[a-z]+)?["'])`)
    const fragment = from.file!.fragments.find(part => part.lines.some(line => pattern.test(line)))
    if (!fragment) continue
    const offset = fragment.lines.findIndex(line => pattern.test(line))
    const startLine = fragment.startLine === null ? null : fragment.startLine + offset
    relations.push({ from: from.path, to: to.path, kind: 'lexical-reference', evidence: [{ sourceId: fragment.sources.at(-1)!, path: from.path, fileVersion: from.file!.version, startLine, endLine: startLine }] })
  }
  for (const edge of relations) {
    const from = nodes.find(node => node.path === edge.from)!, to = nodes.find(node => node.path === edge.to)!
    if (from.score >= 10) to.score += 5
  }
  return { nodes: nodes.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)), relations: relations.slice(0, 50) }
}
function usefulFragment(fragment: Fragment, question: string): Fragment {
  if (fragment.lines.length <= 70) return fragment
  const query = terms(question)
  const hit = fragment.lines.findIndex(line => query.some(term => line.toLowerCase().includes(term)))
  const start = Math.max(0, hit < 0 ? 0 : hit - 15), end = Math.min(fragment.lines.length, start + 70)
  return { ...fragment, sources: [...fragment.sources], startLine: fragment.startLine === null ? null : fragment.startLine + start, lines: fragment.lines.slice(start, end), endOfFile: fragment.endOfFile && end === fragment.lines.length }
}
export function buildContext(state: CoachState, maxCharacters: number = LIMITS.context, index = new EvidenceIndex()): ContextPacket {
  if (!state.permission || !state.question) throw new Error('A permitted session and question are required')
  integer(maxCharacters, 4000, LIMITS.context)
  const ranked = rankFiles(state, index)
  const packet: ContextPacket = {
    schema: 1, sessionId: state.sessionId, permission: state.permission, question: { ...state.question }, task: { ...state.task, requirements: [...state.task.requirements], constraints: [...state.task.constraints] },
    evidenceVersion: state.evidenceVersion, codeVersion: state.codeVersion, contextKey: '', files: [], knownPaths: ranked.nodes.slice(0, 100).map(node => node.path), relations: [],
    conversation: dialogueContext(state.conversation ?? []),
    visibleView: state.lastScreen ? {
      origin: state.sources.find(source => source.id === state.lastScreen!.sourceId)?.origin ?? 'screen',
      files: state.lastScreen.observation.files.map(file => ({ path: file.path, startLine: file.startLine, endLine: file.startLine === null ? null : file.startLine + file.lines.length - 1 })),
      terminalVisible: !!state.lastScreen.observation.terminal,
    } : null,
    tests: state.tests.slice(-3).map(run => ({ ...run, output: run.output.slice(-2500), outputBefore: '' })),
    patches: state.patches.slice(0, 4).map(patch => ({ ...patch })), patchReviews: state.patchReviews.slice(0, 4),
    budget: { maxCharacters, usedCharacters: 0, omittedPaths: [] },
  }
  // Characters are bounded; this is not an exact token count.
  const fits = () => JSON.stringify(packet).length + 800 <= maxCharacters
  if (!fits()) {
    packet.conversation = packet.conversation?.slice(-3)
    packet.tests = packet.tests.slice(-1)
    packet.patches = []
    if (!fits()) throw new Error('Task and constraints exceed the context budget. Narrow the session objective.')
  }
  for (const node of ranked.nodes.slice(0, 12)) {
    if (!node.file || packet.files.length >= 6) continue
    const file = node.file
    const fragments = file.fragments.map(part => usefulFragment(part, `${state.question!.text} ${state.task.objective}`))
      .sort((a, b) => {
        const score = (part: Fragment) => terms(state.question!.text).filter(term => part.lines.join('\n').toLowerCase().includes(term)).length
        return score(b) - score(a)
      })
    const item: ContextPacket['files'][number] = { path: file.path, language: file.language, fileVersion: file.version, complete: false, fragments: [] }
    packet.files.push(item)
    for (const fragment of fragments) {
      item.fragments.push(fragment)
      if (!fits()) item.fragments.pop()
    }
    if (!item.fragments.length) packet.files.pop()
    else item.complete = fileCoverage({ ...file, fragments: item.fragments }).complete
  }
  const refsInPacket = (ref: EvidenceRef) => packet.files.some(file => file.path === ref.path && file.fileVersion === ref.fileVersion && file.fragments.some(part => part.sources.includes(ref.sourceId) && (ref.startLine === null ? part.startLine === null : part.startLine !== null && ref.startLine >= part.startLine && ref.endLine! < part.startLine + part.lines.length)))
  for (const relation of ranked.relations.filter(edge => edge.evidence.every(refsInPacket))) {
    packet.relations.push(relation)
    if (!fits()) packet.relations.pop()
  }
  packet.budget.omittedPaths = ranked.nodes.filter(node => !packet.files.some(file => file.path === node.path)).slice(0, 20).map(node => node.path)
  packet.contextKey = hashText(JSON.stringify({ ...packet, contextKey: '', budget: undefined }))
  packet.budget.usedCharacters = JSON.stringify(packet).length
  packet.budget.usedCharacters = JSON.stringify(packet).length
  if (packet.budget.usedCharacters > maxCharacters) throw new Error('Compiled context exceeded its hard budget')
  return packet
}
export function nextInspection(state: CoachState): Navigation | null {
  if (state.navigation?.status === 'pending') return state.navigation
  const ranked = rankFiles(state)
  const currentPaths = new Set(state.lastScreen?.observation.files.map(file => file.path) ?? [])
  const linkedMissing = ranked.relations.find(edge => currentPaths.has(edge.from) && !state.files.some(file => file.path === edge.to))
  const selected = ranked.nodes.find(node => node.path === linkedMissing?.to) ?? ranked.nodes.find(node => node.score > 0 && (!node.file || !fileCoverage(node.file).complete)) ?? ranked.nodes[0]
  if (!selected) return null
  let startLine: number | null = 1, reason = 'Inspect the observed target before suggesting a change.'
  if (!selected.file) reason = 'Only this path is known. Show its code and line-number gutter.'
  else {
    const coverage = fileCoverage(selected.file)
    if (coverage.unanchored || coverage.uncertain) { startLine = null; reason = 'Zoom in and show line numbers; existing text is uncertain or unanchored.' }
    else {
      const first = coverage.ranges[0]
      startLine = !first || first.start > 1 ? 1 : first.end + 1
      if (coverage.complete) startLine = 1
      reason = coverage.complete ? 'Review this observed implementation in context.' : 'Show the next missing region with overlapping code. Do not infer unseen lines.'
    }
  }
  return { path: selected.path, startLine, endLine: startLine, symbol: '', reason, status: 'pending', requestedAfter: state.sequence }
}
export function parseContext(raw: unknown): ContextPacket {
  const root = object(raw, ['schema', 'sessionId', 'permission', 'question', 'task', 'evidenceVersion', 'codeVersion', 'contextKey', 'files', 'knownPaths', 'relations', 'tests', 'patches', 'patchReviews', 'visibleView', 'conversation', 'budget'])
  if (root.schema !== 1 || JSON.stringify(root).length > LIMITS.context + 100) throw new Error('Invalid context envelope or size')
  const task = object(root.task, ['objective', 'requirements', 'constraints', 'phase', 'implementation', 'version', 'spokenRequirements', 'requirementClarifications'])
  if (!['understand', 'explore', 'plan', 'implement', 'debug', 'review'].includes(String(task.phase)) || !['hold', 'allowed'].includes(String(task.implementation))) throw new Error('Invalid task state')
  const question = object(root.question, ['id', 'original', 'text', 'at'])
  const parsedTask: Task = { objective: text(task.objective, 4000, true), requirements: list(task.requirements, 50).map(value => text(value, 1000, true)), constraints: list(task.constraints, 30).map(value => text(value, 1000, true)), phase: task.phase as Task['phase'], implementation: task.implementation as Task['implementation'], version: integer(task.version) }
  const spoken = (value: unknown): SpokenRequirement[] => list(value, 160).map(raw => {
    const row = object(raw, ['sourceId', 'at', 'text'])
    return { sourceId: text(row.sourceId, 120, true), at: integer(row.at), text: text(row.text, 1000, true) }
  })
  if (task.spokenRequirements !== undefined) parsedTask.spokenRequirements = spoken(task.spokenRequirements)
  if (task.requirementClarifications !== undefined) parsedTask.requirementClarifications = spoken(task.requirementClarifications)
  const knownPaths = list(root.knownPaths, 100).map(safePath)
  const files = list(root.files, 6).map(rawFile => {
    const file = object(rawFile, ['path', 'language', 'fileVersion', 'complete', 'fragments']), path = safePath(file.path)
    if (!knownPaths.includes(path) || typeof file.complete !== 'boolean') throw new Error('File identity is missing from known paths')
    const fragments = list(file.fragments, LIMITS.fragments).map(rawPart => {
      const part = object(rawPart, ['path', 'language', 'startLine', 'lines', 'confidence', 'endOfFile', 'sources'])
      const { sources, ...rest } = part
      const observed = parseObservation({ files: [rest], visiblePaths: [], terminal: '', requirements: [] }).files[0]
      if (!observed || observed.path !== path || observed.language !== file.language) throw new Error('Fragment/file identity mismatch')
      const parsedSources = list(sources, 12).map(value => text(value, 100, true))
      if (!parsedSources.length) throw new Error('Missing source')
      return { ...observed, sources: parsedSources }
    })
    const parsed = { path, language: text(file.language, 40, true), fileVersion: integer(file.fileVersion, 1), complete: false, fragments }
    parsed.complete = fileCoverage({ ...parsed, version: parsed.fileVersion, retired: [], contentKey: '', lastSeen: 0 }).complete
    return parsed
  })
  if (new Set(files.map(file => file.path)).size !== files.length) throw new Error('Duplicate file identity')
  for (const file of files) {
    const anchors = new Map<number, string>()
    for (const fragment of file.fragments) if (fragment.startLine !== null) fragment.lines.forEach((line, index) => {
      const at = fragment.startLine! + index
      if (anchors.has(at) && anchors.get(at) !== line) throw new Error('Conflicting current file fragments')
      anchors.set(at, line)
    })
  }
  const relationRefs = (rawRefs: unknown): EvidenceRef[] => list(rawRefs, 12).map(value => {
    const ref = object(value, ['sourceId', 'path', 'fileVersion', 'startLine', 'endLine'])
    return { sourceId: text(ref.sourceId, 100, true), path: safePath(ref.path), fileVersion: integer(ref.fileVersion, 1), startLine: ref.startLine === null ? null : integer(ref.startLine, 1, 100_000), endLine: ref.endLine === null ? null : integer(ref.endLine, 1, 100_000) }
  })
  const relations = list(root.relations, 50).map(value => {
    const edge = object(value, ['from', 'to', 'kind', 'evidence']), from = safePath(edge.from), to = safePath(edge.to)
    if (!knownPaths.includes(from) || !knownPaths.includes(to) || edge.kind !== 'lexical-reference') throw new Error('Unknown graph target')
    const evidence = relationRefs(edge.evidence)
    if (!evidence.length || evidence.some(ref => !files.some(file => file.path === ref.path && file.fileVersion === ref.fileVersion && file.fragments.some(part => part.sources.includes(ref.sourceId) && (ref.startLine === null ? part.startLine === null && ref.endLine === null : ref.endLine !== null && ref.endLine >= ref.startLine && part.startLine !== null && ref.startLine >= part.startLine && ref.endLine < part.startLine + part.lines.length))))) throw new Error('Graph reference is outside supplied evidence')
    return { from, to, kind: 'lexical-reference' as const, evidence }
  })
  const tests: TestEvidence[] = list(root.tests, 3).map(value => {
    const run = object(value, ['id', 'codeVersion', 'startedAfter', 'startedAt', 'command', 'status', 'passed', 'failed', 'sourceId', 'output', 'outputBefore'])
    if (!['awaiting-output', 'running', 'observed-pass', 'observed-fail', 'incomplete', 'stale'].includes(String(run.status))) throw new Error('Invalid test status')
    return { id: text(run.id, 100, true), codeVersion: run.codeVersion === null ? null : integer(run.codeVersion), startedAfter: run.startedAfter === null ? null : integer(run.startedAfter), startedAt: run.startedAt === null ? null : integer(run.startedAt), command: text(run.command, 500), status: run.status as TestEvidence['status'], passed: run.passed === null ? null : integer(run.passed, 0, 1_000_000), failed: run.failed === null ? null : integer(run.failed, 0, 1_000_000), sourceId: run.sourceId === null ? null : text(run.sourceId, 100, true), output: text(run.output, 2500), outputBefore: text(run.outputBefore, 0) }
  })
  const patches: Patch[] = list(root.patches, 4).map(value => {
    const patch = object(value, ['id', 'path', 'fileVersion', 'startLine', 'before', 'after', 'reason', 'evidence'])
    return { id: text(patch.id, 100, true), path: safePath(patch.path), fileVersion: integer(patch.fileVersion, 1), startLine: integer(patch.startLine, 1, 100_000), before: text(patch.before, 6000, true), after: text(patch.after, 6000), reason: text(patch.reason, 1000, true), evidence: relationRefs(patch.evidence) }
  })
  const patchReviews: PatchReview[] = list(root.patchReviews, 4).map(value => {
    const review = object(value, ['patchId', 'status', 'detail', 'observedSource'])
    if (!['not-observed', 'matches-proposal', 'differs', 'incomplete', 'reverted'].includes(String(review.status))) throw new Error('Invalid patch review')
    return { patchId: text(review.patchId, 100, true), status: review.status as PatchReview['status'], detail: text(review.detail, 1000), observedSource: review.observedSource === null ? null : text(review.observedSource, 100, true) }
  })
  let visibleView: ContextPacket['visibleView'] = null
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
  const conversation = root.conversation === undefined ? [] : list(root.conversation, 8).map(parseDialogueTurn)
  const budget = object(root.budget, ['maxCharacters', 'usedCharacters', 'omittedPaths'])
  return { schema: 1, sessionId: text(root.sessionId, 100, true), permission: permission(root.permission), question: { id: text(question.id, 100, true), original: text(question.original, 4000, true), text: text(question.text, 2000, true), at: integer(question.at) }, task: parsedTask,
    evidenceVersion: integer(root.evidenceVersion), codeVersion: integer(root.codeVersion), contextKey: text(root.contextKey, 100, true), files, knownPaths, relations, visibleView, conversation, tests, patches, patchReviews,
    budget: { maxCharacters: integer(budget.maxCharacters, 4000, LIMITS.context), usedCharacters: integer(budget.usedCharacters, 0, LIMITS.context), omittedPaths: list(budget.omittedPaths, 20).map(safePath) } }
}
