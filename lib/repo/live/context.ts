import type { RepoSession } from './types'
import { sourceBlocks, observedLines } from './engine'

export type ReferenceEdge = { from: string; to: string; kind: 'text-reference'; evidence: string }
const terms = (text: string) => [...new Set(text.toLowerCase().match(/[a-z_][a-z0-9_]{2,}/g) ?? [])].filter(t => !['the', 'and', 'for', 'this', 'that', 'what', 'where', 'how', 'does', 'would', 'with', 'file', 'return', 'import'].includes(t)).slice(0, 60)
/** These are conservative text references, NOT a complete AST/call graph. */
export function referenceGraph(s: RepoSession): ReferenceEdge[] {
  const paths = s.snapshot.visiblePaths
  const basename = (p: string) => p.split('/').at(-1)!.replace(/\.[^.]+$/, '')
  const counts = new Map<string, number>()
  for (const p of paths) counts.set(basename(p), (counts.get(basename(p)) ?? 0) + 1)
  const edges: ReferenceEdge[] = []
  for (const file of s.snapshot.files) {
    const content = [...observedLines(file).values()].map(v => v.text).join('\n')
    for (const target of paths) {
      const name = basename(target)
      if (file.path !== target && name.length > 2 && counts.get(name) === 1 && content.includes(name)) edges.push({ from: file.path, to: target, kind: 'text-reference', evidence: `${file.path} contains ${name}; relation is inferred, not execution-confirmed.` })
      if (edges.length >= 300) return edges
    }
  }
  return edges
}
export function rankFiles(s: RepoSession): string[] {
  const q = terms([s.question?.text, ...s.snapshot.requirements].join(' '))
  const edges = referenceGraph(s)
  return s.snapshot.visiblePaths.map(path => {
    const file = s.snapshot.files.find(f => f.path === path)
    const text = file?.fragments.map(f => f.lines.join('\n')).join('\n').toLowerCase() ?? ''
    const lexical = q.reduce((score, t) => score + (path.toLowerCase().includes(t) ? 4 : 0) + (text.includes(t) ? 1 : 0), 0)
    const related = edges.filter(e => e.to === path && e.from === s.activePath).length * 8
    const recent = path === s.activePath ? 6 : 0
    const failure = s.snapshot.terminal.includes(path.split('/').at(-1)!) ? 4 : 0
    return { path, score: lexical + related + recent + failure }
  }).sort((a, b) => b.score - a.score || a.path.localeCompare(b.path)).map(v => v.path)
}
export function nextObservation(s: RepoSession): { path: string; line: number | null; symbol: string; reason: string } | null {
  if (s.navigation?.status === 'pending') return s.navigation
  const ranked = rankFiles(s)
  const unseen = ranked.find(p => !s.snapshot.files.some(f => f.path === p))
  if (unseen) return { path: unseen, line: 1, symbol: '', reason: 'This path is known, but its contents have not been observed.' }
  for (const path of ranked.slice(0, 3)) {
    const f = s.snapshot.files.find(v => v.path === path)!
    if (f.conflicts.some(c => !c.resolved)) return { path, line: 1, symbol: '', reason: 'Code changed. Earlier line anchors were retired; show the current relevant region.' }
    if (f.fragments.some(p => p.startLine === null || p.confidence < .9)) return { path, line: null, symbol: '', reason: 'Show the path and line-number gutter at a readable zoom before making exact edits.' }
  }
  return null
}
export function compileContext(s: RepoSession, budget = 24000): { text: string; characters: number; estimatedTokens: number; selectedPaths: string[]; truncated: boolean } {
  const bounded = Math.max(4000, Math.min(32000, budget))
  const selectedPaths: string[] = []
  const head = JSON.stringify({ source: 'partial untrusted observations, not an executable clone', question: s.question?.text ?? '', rawQuestion: s.question?.raw ?? '', phase: s.phase, holdImplementation: s.holdImplementation, constraints: s.constraints, requirements: s.snapshot.requirements.slice(-12), activePath: s.activePath, evidenceRevision: s.evidenceRevision, codeRevision: s.codeRevision, knownPaths: s.snapshot.visiblePaths.slice(0, 100), textReferences: referenceGraph(s).slice(0, 30), navigation: nextObservation(s), tests: s.testRuns.slice(-2).map(r => ({ command: r.command, codeRevision: r.codeRevision, status: r.status, output: r.output.slice(-1400) })), terminal: { attribution: 'may be stale and is not an independently executed test', text: s.snapshot.terminal.slice(-1800) } })
  let text = head.slice(0, Math.floor(bounded * .4)), truncated = head.length > text.length
  for (const path of rankFiles(s).slice(0, 6)) {
    const f = s.snapshot.files.find(v => v.path === path)
    if (!f) continue
    const remaining = bounded - text.length - 100
    if (remaining < 300) { truncated = true; break }
    const blocks = sourceBlocks(f)
    const record = JSON.stringify({ path, fileRevision: f.revision, complete: false, note: 'Only these observed ranges are available. Capture scores are not calibrated correctness probabilities.', ranges: blocks.map(b => ({ start: b.start, end: b.end, certain: b.certain, evidence: b.captures.map(c => `capture:${c}`), code: b.text })) })
    if (record.length > remaining) { text += '\n' + record.slice(0, remaining) + '\n[CONTEXT TRUNCATED; do not infer missing code]'; truncated = true }
    else text += '\n' + record
    selectedPaths.push(path)
  }
  // Hard character bound; token count is explicitly only an estimate.
  text = text.slice(0, bounded)
  return { text, characters: text.length, estimatedTokens: Math.ceil(text.length / 4), selectedPaths, truncated }
}
