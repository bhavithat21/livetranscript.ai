import type { RepoSession } from './types'
import type { ScreenFile } from '../screenEvidence'
import { sourceBlocks, observedLines } from './engine'

export type ReferenceEdge = { from: string; to: string; kind: 'text-reference'; evidence: string }
const terms = (text: string) => [...new Set(text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? [])].filter(t => !['the', 'and', 'for', 'this', 'that', 'what', 'where', 'how', 'does', 'would', 'with', 'file', 'return', 'import'].includes(t)).slice(0, 60)
// Immutable ScreenFile identity changes on an observation; a WeakMap safely
// reuses derived source across requests without persisting code after a session.
const cache = new WeakMap<ScreenFile, { content: string; blocks: ReturnType<typeof sourceBlocks> }>()
function source(file: ScreenFile) {
  let value = cache.get(file)
  if (!value) { value = { content: [...observedLines(file).values()].map(v => v.text).join('\n'), blocks: sourceBlocks(file) }; cache.set(file, value) }
  return value
}
/** Inferred text references only; a screenshot cannot establish a full call graph. */
export function referenceGraph(s: RepoSession): ReferenceEdge[] {
  const paths = s.snapshot.visiblePaths, basename = (p: string) => p.split('/').at(-1)!.replace(/\.[^.]+$/, '')
  const counts = new Map<string, number>()
  for (const p of paths) counts.set(basename(p), (counts.get(basename(p)) ?? 0) + 1)
  const edges: ReferenceEdge[] = []
  for (const file of s.snapshot.files) for (const target of paths) {
    const name = basename(target)
    if (file.path !== target && name.length > 2 && counts.get(name) === 1 && source(file).content.includes(name)) edges.push({ from: file.path, to: target, kind: 'text-reference', evidence: `${file.path} contains ${name}; relation is inferred, not execution-confirmed.` })
    if (edges.length >= 300) return edges
  }
  return edges
}
export function rankFiles(s: RepoSession): string[] {
  const q = terms([s.question?.text, ...s.snapshot.requirements].join(' ')), edges = referenceGraph(s)
  return s.snapshot.visiblePaths.map(path => {
    const file = s.snapshot.files.find(f => f.path === path), text = file ? source(file).content.toLowerCase() : ''
    const lexical = q.reduce((score, t) => score + (path.toLowerCase().includes(t) ? 4 : 0) + (text.includes(t) ? 1 : 0), 0)
    const related = edges.filter(e => e.to === path && e.from === s.activePath).length * 8
    return { path, score: lexical + related + (path === s.activePath ? 6 : 0) + (s.snapshot.terminal.includes(path.split('/').at(-1)!) ? 4 : 0) }
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).map(v => v.path)
}
export function nextObservation(s: RepoSession): { path: string; line: number | null; symbol: string; reason: string } | null {
  if (s.navigation?.status === 'pending') return s.navigation
  const ranked = rankFiles(s), unseen = ranked.find(p => !s.snapshot.files.some(f => f.path === p))
  if (unseen) return { path: unseen, line: null, symbol: '', reason: 'This path is known, but its contents have not been observed.' }
  for (const path of ranked.slice(0, 3)) {
    const f = s.snapshot.files.find(v => v.path === path)!
    if (f.conflicts.some(c => !c.resolved)) return { path, line: null, symbol: '', reason: 'Code changed. Earlier anchors were retired; show the current relevant region.' }
    if (f.fragments.some(p => p.startLine === null || p.confidence < .9)) return { path, line: null, symbol: '', reason: 'Show the path and line-number gutter at a readable zoom before making exact edits.' }
  }
  return null
}
export function compileContext(s: RepoSession, budget = 24000): { text: string; characters: number; estimatedTokens: number; selectedPaths: string[]; truncated: boolean } {
  const bounded = Math.max(4000, Math.min(32000, budget)), selectedPaths: string[] = []
  const sections: string[] = [], selected = rankFiles(s).slice(0, 6)
  let used = 0, truncated = false
  function append(value: unknown, limit: number) {
    const json = JSON.stringify(value)
    if (json.length > Math.min(limit, bounded - used - 1)) { truncated = true; return false }
    sections.push(json); used += json.length + 1; return true
  }
  append({ type: 'task', warning: 'Untrusted partial observations, not an executed clone. Proposed edits are NOT source.', question: s.question?.text.slice(0, 1200) ?? '', phase: s.phase, holdImplementation: s.holdImplementation, constraints: s.constraints, requirements: s.snapshot.requirements.slice(-6).map(r => r.slice(0, 400)), activePath: s.activePath, evidenceRevision: s.evidenceRevision, codeRevision: s.codeRevision }, Math.floor(bounded * .35))
  append({ type: 'index', knownPaths: s.snapshot.visiblePaths.slice(0, 60), inferredTextReferences: referenceGraph(s).filter(e => selected.includes(e.from)).slice(0, 12), nextObservation: nextObservation(s) }, Math.floor(bounded * .25))
  // Prior suggestions are explicitly separated from current source for edit review.
  append({ type: 'proposals-not-source', edits: s.edits.slice(-3).map(e => ({ path: e.path, status: e.status, note: e.note, before: e.before.slice(0, 1000), suggestedAfter: e.after.slice(0, 1000), fileRevisionWhenProposed: e.fileRevision })) }, Math.floor(bounded * .2))
  append({ type: 'test-evidence', runs: s.testRuns.slice(-2).map(r => ({ command: r.command, codeRevision: r.codeRevision, status: r.status, output: r.output.slice(-1000) })), lastTerminal: { warning: 'May be stale, not independently executed', text: s.snapshot.terminal.slice(-1000) } }, Math.floor(bounded * .2))
  for (const path of selected) {
    const file = s.snapshot.files.find(v => v.path === path)
    if (!file) continue
    let included = false
    for (const b of source(file).blocks) {
      // Emit whole line groups. Never truncate JSON or a line mid-token and call it source.
      const lines = b.text.split('\n')
      for (let offset = 0; offset < lines.length; offset += 40) {
        const group = lines.slice(offset, offset + 40)
        const record = { type: 'observed-code', path, fileRevision: file.revision, start: b.start + offset, end: b.start + offset + group.length - 1, completeFile: false, highExtractionScore: b.certain, scoreWarning: 'not a calibrated correctness probability', evidence: b.captures.map(c => `capture:${c}`), lines: group }
        if (append(record, bounded)) included = true
      }
    }
    if (included) selectedPaths.push(path)
  }
  if (truncated) append({ type: 'notice', text: 'Context budget exhausted. Omitted regions remain unknown; request a focused observation.' }, bounded)
  const text = sections.join('\n')
  return { text, characters: text.length, estimatedTokens: Math.ceil(text.length / 4), selectedPaths, truncated }
}
