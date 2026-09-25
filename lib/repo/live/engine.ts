import { emptyScreenSnapshot, mergeScreenObservation, parseScreenObservation, screenFileSummary } from '../screenEvidence'
import type { ScreenFile, ScreenObservation } from '../screenEvidence'
import type { CodePlan, EditSuggestion, EventData, RepoEvent, RepoSession, RunEvidence, Stamp } from './types'

export const MAX_EVENTS = 600
export const MAX_REPLAY_BYTES = 8_000_000
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
export function safePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 320 && value.trim() === value && !/[\\:\r\n\t]/.test(value) && value.split('/').every(p => !!p && p !== '.' && p !== '..' && !FORBIDDEN.has(p)) && !/(^|\/)(?:\.env(?:\.|$)|id_(?:rsa|ed25519)|credentials(?:\.|$)|secrets?(?:\.|$)|[^/]*\.(?:pem|key|p12|pfx)$)/i.test(value)
}
function obj(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => FORBIDDEN.has(k))) throw new Error('Invalid object')
  return v as Record<string, unknown>
}
function txt(v: unknown, max = 6000): string { if (typeof v !== 'string' || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) throw new Error('Invalid or oversized text'); return v }
function num(v: unknown, max = Number.MAX_SAFE_INTEGER): number { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0 || v > max) throw new Error('Invalid integer'); return v }
function arr(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || v.length > max) throw new Error('Invalid array'); return v }
export function normalizeQuestion(raw: string): string {
  return raw.replace(/^(?:(?:interviewer|user call|speaker\s*\d+|call)\s*[:/]\s*)+/i, '').replace(/^(?:(?:so|okay|ok|well|um|uh|first of all|now)[,\s]+)+/i, '').replace(/\s+/g, ' ').trim().slice(0, 2000)
}
export function createSession(id: string, startedAt = Date.now()): RepoSession {
  return { schema: 1, id, startedAt, seq: 0, paused: false, snapshot: emptyScreenSnapshot(), evidenceRevision: 0, codeRevision: 0, activePath: null, question: null, phase: 'understand', holdImplementation: false, constraints: [], navigation: null, edits: [], plan: null, say: null, testRuns: [], feedback: [], events: [], journalTruncated: false, discardedResults: 0 }
}
export function stampFor(s: RepoSession): Stamp { return { sessionId: s.id, questionId: s.question?.id ?? '', evidenceRevision: s.evidenceRevision, codeRevision: s.codeRevision } }
export function sameStamp(a: Stamp, b: Stamp): boolean { return a.sessionId === b.sessionId && a.questionId === b.questionId && a.evidenceRevision === b.evidenceRevision && a.codeRevision === b.codeRevision }
export function makeEvent(s: RepoSession, value: EventData, at = Date.now()): RepoEvent { return { schema: 1, sessionId: s.id, seq: s.seq + 1, at, ...value } as RepoEvent }
export function observedLines(file: ScreenFile): Map<number, { text: string; confidence: number; captures: number[] }> {
  const lines = new Map<number, { text: string; confidence: number; captures: number[] }>()
  for (const part of file.fragments) {
    if (part.startLine === null) continue
    part.lines.forEach((text, index) => { const n = part.startLine! + index, old = lines.get(n); lines.set(n, { text, confidence: part.confidence, captures: old?.text === text ? [...new Set([...old.captures, part.capture])].slice(-6) : [part.capture] }) })
  }
  return lines
}
export function sourceBlocks(file: ScreenFile): Array<{ start: number; end: number; text: string; certain: boolean; captures: number[] }> {
  const blocks: Array<{ start: number; end: number; text: string; certain: boolean; captures: number[] }> = []
  for (const [n, line] of [...observedLines(file)].sort(([a], [b]) => a - b)) {
    const last = blocks.at(-1)
    if (last && last.end + 1 === n && last.certain === (line.confidence >= .9)) { last.end = n; last.text += '\n' + line.text; last.captures = [...new Set([...last.captures, ...line.captures])] }
    else blocks.push({ start: n, end: n, text: line.text, certain: line.confidence >= .9, captures: line.captures })
  }
  return blocks
}
/** Exact unique observed preimage only; a suggestion never creates source evidence. */
export function anchorEdit(file: ScreenFile | undefined, before: string): number | null {
  if (!file || !before.trim()) return null
  const hits: number[] = []
  for (const block of sourceBlocks(file).filter(b => b.certain)) {
    let offset = 0
    while (offset <= block.text.length) { const i = block.text.indexOf(before, offset); if (i < 0) break; hits.push(block.start + block.text.slice(0, i).split('\n').length - 1); offset = i + Math.max(1, before.length) }
  }
  return hits.length === 1 ? hits[0] : null
}
export function parsePlan(raw: unknown): CodePlan {
  const p = obj(raw)
  if (Object.keys(p).some(k => !['summary', 'navigation', 'edits', 'checks', 'verify', 'missingEvidence'].includes(k))) throw new Error('Unknown plan field')
  const edits = arr(p.edits, 6).map(value => { const e = obj(value); if (!safePath(e.path)) throw new Error('Invalid edit path'); return { path: e.path, before: txt(e.before, 8000), after: txt(e.after, 10000), reason: txt(e.reason, 1200) } })
  const navigation = p.navigation === null ? null : (() => { const n = obj(p.navigation); if (!safePath(n.path)) throw new Error('Invalid navigation path'); const line = n.line === null ? null : num(n.line, 100000); if (line === 0) throw new Error('Invalid line'); return { path: n.path, line, symbol: txt(n.symbol, 200), reason: txt(n.reason, 1200) } })()
  const checks = arr(p.checks, 12).map(value => { const c = obj(value); if (!['blocking', 'important', 'optional'].includes(String(c.severity))) throw new Error('Invalid check severity'); return { severity: c.severity as 'blocking' | 'important' | 'optional', text: txt(c.text, 1500) } })
  return { summary: txt(p.summary, 3000), navigation, edits, checks, verify: arr(p.verify, 6).map(v => txt(v, 500)), missingEvidence: arr(p.missingEvidence, 12).map(v => txt(v, 1200)) }
}
function parseStamp(raw: unknown): Stamp { const s = obj(raw); return { sessionId: txt(s.sessionId, 100), questionId: txt(s.questionId, 120), evidenceRevision: num(s.evidenceRevision), codeRevision: num(s.codeRevision) } }
/** All replay fields pass the same boundary as live data. No commands are executed. */
export function parseEvent(raw: unknown): RepoEvent {
  const e = obj(raw), d = obj(e.data)
  if (e.schema !== 1) throw new Error('Unsupported event schema')
  const base = { schema: 1 as const, sessionId: txt(e.sessionId, 100), seq: num(e.seq), at: num(e.at) }
  switch (e.kind) {
    case 'observation': {
      if (!['screen', 'file-import', 'fixture'].includes(String(d.origin))) throw new Error('Invalid origin')
      const observation = parseScreenObservation(d.observation)
      if (d.activePath !== null && (!safePath(d.activePath) || !observation.files.some(f => f.path === d.activePath))) throw new Error('Active file must be observed now')
      return { ...base, kind: 'observation', data: { observation, activePath: d.activePath as string | null, origin: d.origin as 'screen' | 'file-import' | 'fixture' } }
    }
    case 'question': return { ...base, kind: 'question', data: { id: txt(d.id, 120), raw: txt(d.raw, 4000) } }
    case 'utterance': if (!['interviewer', 'candidate'].includes(String(d.speaker))) throw new Error('Invalid speaker'); return { ...base, kind: 'utterance', data: { text: txt(d.text, 4000), speaker: d.speaker as 'interviewer' | 'candidate' } }
    case 'plan': return { ...base, kind: 'plan', data: { stamp: parseStamp(d.stamp), plan: parsePlan(d.plan), model: txt(d.model, 160), elapsedMs: num(d.elapsedMs, 180000) } }
    case 'say': return { ...base, kind: 'say', data: { stamp: parseStamp(d.stamp), text: txt(d.text, 12000), model: txt(d.model, 160), firstTokenMs: d.firstTokenMs === null ? null : num(d.firstTokenMs, 180000), elapsedMs: num(d.elapsedMs, 180000) } }
    case 'test-start': return { ...base, kind: 'test-start', data: { command: txt(d.command, 500) } }
    case 'feedback': if (!['pass', 'needs-work'].includes(String(d.verdict))) throw new Error('Invalid feedback'); return { ...base, kind: 'feedback', data: { target: txt(d.target, 160), verdict: d.verdict as 'pass' | 'needs-work', note: txt(d.note, 2000) } }
    case 'pause': if (typeof d.paused !== 'boolean') throw new Error('Invalid pause'); return { ...base, kind: 'pause', data: { paused: d.paused } }
    default: throw new Error('Unknown event')
  }
}
function applyIntent(s: RepoSession, utterance: string): RepoSession {
  let next = s
  if (/\b(?:don['’]?t|do not|not yet)\s+(?:start\s+)?(?:code|implement)|\b(?:explain|plan)\s+(?:first|before coding)/i.test(utterance)) next = { ...next, holdImplementation: true, phase: 'plan', edits: [], plan: null }
  else if (/\b(?:go ahead|okay|ok|now|please|let['’]?s)\b.{0,25}\b(?:implement|code|make the change)/i.test(utterance)) next = { ...next, holdImplementation: false, phase: 'implement' }
  const additions: string[] = []
  if (/\b(?:don['’]?t|do not)\s+(?:change|modify)\s+(?:the\s+)?(?:public\s+)?api/i.test(utterance)) additions.push('Preserve the public API.')
  if (/\b(?:no external|without external|don['’]?t add)\s+(?:libraries|dependencies)/i.test(utterance)) additions.push('Do not add external dependencies.')
  if (/\b(?:prioritize|optimi[sz]e for)\s+readability/i.test(utterance)) additions.push('Prioritize readability over refactoring.')
  if (/\b(?:don['’]?t worry about|skip)\s+(?:the\s+)?tests/i.test(utterance)) additions.push('Interviewer deprioritized tests; do not claim they passed.')
  return additions.length ? { ...next, constraints: [...new Set([...next.constraints, ...additions])].slice(-30) } : next
}
export function parseTestSummary(text: string): { passed: number | null; failed: number | null; status: 'pass' | 'fail' } | null {
  const relevant = text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').filter(l => !/^\s*(?:\/\/|#|\*)/.test(l)).slice(-60).join('\n')
  const py = relevant.match(/(?:^|\n|=+)\s*(\d+) passed(?:[,\s]+(\d+) failed)?[^\n]*$/m)
  const ff = relevant.match(/(?:^|\n|=+)\s*(\d+) failed(?:[,\s]+(\d+) passed)?[^\n]*$/m)
  const jest = relevant.match(/(?:^|\n)\s*Tests:\s*(?:(\d+) failed,?\s*)?(?:(\d+) passed,?\s*)?[^\n]*\btotal/m)
  const dotnet = relevant.match(/(?:Passed!|Failed!)\s*-\s*Failed:\s*(\d+),\s*Passed:\s*(\d+)/)
  const java = relevant.match(/Tests run:\s*(\d+),\s*Failures:\s*(\d+),\s*Errors:\s*(\d+)/)
  if (jest && (jest[1] || jest[2])) return { passed: Number(jest[2] || 0), failed: Number(jest[1] || 0), status: Number(jest[1] || 0) > 0 ? 'fail' : 'pass' }
  if (dotnet) return { passed: +dotnet[2], failed: +dotnet[1], status: +dotnet[1] > 0 ? 'fail' : 'pass' }
  if (java) return { passed: Math.max(0, +java[1] - +java[2] - +java[3]), failed: +java[2] + +java[3], status: +java[2] + +java[3] ? 'fail' : 'pass' }
  if (ff) return { passed: ff[2] ? +ff[2] : null, failed: +ff[1], status: 'fail' }
  if (py) return { passed: +py[1], failed: py[2] ? +py[2] : 0, status: Number(py[2] || 0) > 0 ? 'fail' : 'pass' }
  if (/^FAIL(?:\s|$)/m.test(relevant)) return { passed: null, failed: null, status: 'fail' }
  return null
}
function checkObservedEdit(edit: EditSuggestion, observation: ScreenObservation, snapshot: RepoSession['snapshot']): EditSuggestion {
  const seen = observation.files.find(f => f.path === edit.path)
  if (!seen) return edit
  const file = snapshot.files.find(f => f.path === edit.path)
  if (!file) return { ...edit, status: 'stale', note: 'Source is no longer retained.' }
  if (anchorEdit(file, edit.after) !== null) return { ...edit, status: 'matched', note: 'Suggested text is visible. This is not a correctness or test verdict.' }
  if (seen.startLine === null || seen.confidence < .9 || edit.line < seen.startLine || edit.line + edit.before.split('\n').length - 1 >= seen.startLine + seen.lines.length) return { ...edit, status: 'not-visible', note: 'Show the complete edited region with a readable line gutter.' }
  if (anchorEdit(file, edit.before) !== null) return { ...edit, status: 'proposed', note: 'The original text is still visible.' }
  const changed = seen.lines.join('\n')
  const operatorsDiffer = (edit.after.includes('&&') && changed.includes('||')) || (edit.after.includes('||') && changed.includes('&&'))
  return { ...edit, status: 'different', note: operatorsDiffer ? 'Boolean operator differs from the suggestion. Check semantics: an alternative may be equivalent.' : 'Observed code differs. It may be equivalent; review semantics rather than assuming it is wrong.' }
}
export function reduceRepoEvent(previous: RepoSession, input: RepoEvent): RepoSession {
  const e = parseEvent(input)
  if (e.sessionId !== previous.id || e.seq <= previous.seq) return previous
  if (e.seq !== previous.seq + 1 || e.at < (previous.events.at(-1)?.at ?? previous.startedAt)) throw new Error('Events must be ordered and contiguous')
  let s: RepoSession = { ...previous, seq: e.seq, events: [...previous.events, e].slice(-MAX_EVENTS), journalTruncated: previous.journalTruncated || previous.events.length >= MAX_EVENTS }
  switch (e.kind) {
    case 'pause': return { ...s, paused: e.data.paused }
    case 'feedback': return { ...s, feedback: [...s.feedback, { ...e.data, at: e.at }].slice(-100) }
    case 'utterance': return e.data.speaker === 'interviewer' ? applyIntent(s, e.data.text) : s
    case 'question': {
      s = applyIntent(s, e.data.raw)
      const text = normalizeQuestion(e.data.raw)
      if (!text || text.toLowerCase().replace(/\W/g, '') === s.question?.text.toLowerCase().replace(/\W/g, '')) return s
      return { ...s, question: { ...e.data, text, at: e.at }, say: null, plan: null, navigation: null, edits: [], phase: s.holdImplementation ? 'plan' : 'explore' }
    }
    case 'observation': {
      const o = e.data.observation, snapshot = mergeScreenObservation(s.snapshot, o)
      const existing = new Map(s.snapshot.files.map(f => [f.path, f.revision]))
      const changed = snapshot.files.some(f => existing.has(f.path) && existing.get(f.path) !== f.revision)
      const representation = (x: typeof snapshot) => JSON.stringify({ files: x.files.map(f => [f.path, f.revision, [...observedLines(f)].map(([n, l]) => [n, l.text, l.confidence]), f.fragments.filter(b => b.startLine === null).map(b => b.lines)]), paths: x.visiblePaths, terminal: x.terminal, requirements: x.requirements })
      const meaningful = representation(snapshot) !== representation(s.snapshot), codeRevision = s.codeRevision + (changed ? 1 : 0)
      let navigation = s.navigation
      if (navigation && o.files.some(f => f.path === navigation!.path && f.confidence >= .9 && (navigation!.line === null || (f.startLine !== null && navigation!.line >= f.startLine && navigation!.line < f.startLine + f.lines.length)) && (!navigation!.symbol || f.lines.some(l => l.includes(navigation!.symbol))))) navigation = { ...navigation, status: 'observed' }
      const testRuns: RunEvidence[] = s.testRuns.map(run => run.codeRevision !== codeRevision ? { ...run, status: 'stale' } : run)
      return { ...s, snapshot, activePath: e.data.activePath ?? s.activePath, evidenceRevision: s.evidenceRevision + (meaningful ? 1 : 0), codeRevision, navigation, edits: s.edits.map(edit => checkObservedEdit(edit, o, snapshot)), testRuns, say: changed ? null : s.say, plan: changed ? null : s.plan, phase: changed && !s.holdImplementation ? 'review' : s.phase }
    }
    case 'say': {
      const ok = e.data.stamp.sessionId === s.id && e.data.stamp.questionId === s.question?.id && e.data.stamp.codeRevision === s.codeRevision && !s.paused
      return ok ? { ...s, say: { text: e.data.text, model: e.data.model, firstTokenMs: e.data.firstTokenMs, elapsedMs: e.data.elapsedMs } } : { ...s, discardedResults: s.discardedResults + 1 }
    }
    case 'plan': {
      if (!sameStamp(e.data.stamp, stampFor(s)) || s.paused) return { ...s, discardedResults: s.discardedResults + 1 }
      const p = e.data.plan, known = new Set(s.snapshot.visiblePaths)
      const navigation = p.navigation && known.has(p.navigation.path) ? { ...p.navigation, status: 'pending' as const, requestedAt: e.at } : null
      const edits: EditSuggestion[] = [], rejected: string[] = []
      if (!s.holdImplementation) for (const [i, edit] of p.edits.entries()) {
        const file = s.snapshot.files.find(f => f.path === edit.path), line = anchorEdit(file, edit.before)
        if (!file || line === null || !edit.after.trim()) { rejected.push(`Recapture ${edit.path}: the proposed preimage is missing, ambiguous, uncertain, or the replacement is empty.`); continue }
        edits.push({ ...edit, id: `${s.id}:${e.seq}:${i}`, line, fileRevision: file.revision, status: 'proposed', note: 'Proposed only; not applied or verified.' })
      }
      return { ...s, navigation: navigation ?? s.navigation, edits, plan: { ...p, edits: s.holdImplementation ? [] : edits, missingEvidence: [...p.missingEvidence, ...rejected].slice(0, 20) }, phase: s.holdImplementation ? 'plan' : edits.length ? 'implement' : 'explore' }
    }
    case 'test-start': {
      const run: RunEvidence = { id: `${s.id}:${e.seq}`, command: e.data.command, codeRevision: s.codeRevision, startedAt: e.at, initialTerminal: s.snapshot.terminal, status: 'waiting', output: '', passed: null, failed: null }
      return { ...s, testRuns: [...s.testRuns, run].slice(-30) }
    }
  }
}
export function coverage(s: RepoSession) { return s.snapshot.files.map(screenFileSummary) }
