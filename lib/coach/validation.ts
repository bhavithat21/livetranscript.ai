import type { Observation, FileObservation, EvidenceRef, ContextPacket, Guidance, Patch, Finding, Navigation, Permission } from './types'

export const LIMITS = { files: 100, paths: 500, fragments: 28, sourceText: 600_000, events: 1200, replayBytes: 4_000_000, context: 24_000, output: 60_000 } as const
const SECRET_PATH = /(^|\/)(?:\.env(?:\.|$)|id_(?:rsa|ed25519)(?:\.|$)|credentials(?:\.|$)|secrets?(?:\.|$)|[^/]*\.(?:pem|key|p12|pfx)$)/i
const BAD_PARTS = new Set(['__proto__', 'constructor', 'prototype'])
export function object(value: unknown, keys?: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Expected a plain object')
  if (keys && Object.keys(value).some(key => !keys.includes(key))) throw new Error('Unexpected field')
  return value as Record<string, unknown>
}
export function text(value: unknown, max: number, required = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) || (required && !value.trim())) throw new Error('Invalid or oversized text')
  return value
}
export function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error('Invalid or oversized list'); return value }
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw new Error('Invalid integer'); return Number(value) }
export function safePath(value: unknown): string {
  const result = text(value, 320, true).replaceAll('\\', '/')
  if (result !== result.trim() || /[:\r\n\t]/.test(result) || result.split('/').some(p => !p || p === '.' || p === '..' || BAD_PARTS.has(p)) || SECRET_PATH.test(result)) throw new Error('Unsafe or credential file path')
  return result
}
export function probability(value: unknown): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid extraction score'); return value }
export function permission(value: unknown): Permission { if (value !== 'practice' && value !== 'external-ai-allowed') throw new Error('Explicit permission is required'); return value }
export function redactSecrets(value: string): string {
  // Defense in depth; not a guarantee that screenshots or arbitrary source contain no secrets.
  return value.replace(/\b(?:sk-(?:proj-|or-v1-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED SECRET]')
    .replace(/((?:api[_-]?key|password|client[_-]?secret|access[_-]?token)\s*[:=]\s*["'])([^"'\n]{8,})(["'])/gi, '$1[REDACTED]$4')
}
export function hashText(value: string): string {
  // Cache identity only, never a cryptographic signature or integrity attestation.
  let a = 2166136261, b = 5381
  for (let i = 0; i < value.length; i++) { a = Math.imul(a ^ value.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ value.charCodeAt(i) }
  return `${(a >>> 0).toString(16)}${(b >>> 0).toString(16)}:${value.length}`
}
export function parseObservation(raw: unknown): Observation {
  const root = object(raw, ['files', 'visiblePaths', 'terminal', 'requirements'])
  const files: FileObservation[] = []
  for (const rawFile of list(root.files, 12)) {
    const item = object(rawFile, ['path', 'language', 'startLine', 'lines', 'confidence', 'endOfFile'])
    const rawPath = text(item.path, 320, true).replaceAll('\\', '/')
    if (SECRET_PATH.test(rawPath)) continue
    const path = safePath(rawPath), language = text(item.language, 40, true)
    if (!/^[a-zA-Z0-9_+#.-]+$/.test(language)) throw new Error('Invalid language identifier')
    const startLine = item.startLine === null ? null : integer(item.startLine, 1, 100_000)
    const lines = list(item.lines, 240).map(line => { const value = text(line, 2000); if (/[\r\n]/.test(value)) throw new Error('One code line per item required'); return redactSecrets(value) })
    if (!lines.length || (startLine !== null && startLine + lines.length > 100_001) || typeof item.endOfFile !== 'boolean') throw new Error('Invalid observed range')
    files.push({ path, language, startLine, lines, confidence: probability(item.confidence), endOfFile: item.endOfFile })
  }
  const visiblePaths = list(root.visiblePaths, 300).map(value => text(value, 320, true).replaceAll('\\', '/')).filter(path => !SECRET_PATH.test(path)).map(safePath)
  const result = { files, visiblePaths: [...new Set(visiblePaths)], terminal: redactSecrets(text(root.terminal, 12_000)), requirements: list(root.requirements, 30).map(value => redactSecrets(text(value, 1000, true))) }
  if (JSON.stringify(result).length > 110_000) throw new Error('Observation exceeds its budget')
  return result
}
function refs(raw: unknown, context: ContextPacket): EvidenceRef[] {
  return list(raw, 12).map(value => {
    const ref = object(value, ['sourceId', 'path', 'fileVersion', 'startLine', 'endLine'])
    const sourceId = text(ref.sourceId, 100, true), path = safePath(ref.path), fileVersion = integer(ref.fileVersion, 1)
    const startLine = ref.startLine === null ? null : integer(ref.startLine, 1, 100_000)
    const endLine = ref.endLine === null ? null : integer(ref.endLine, 1, 100_000)
    const file = context.files.find(item => item.path === path && item.fileVersion === fileVersion)
    const fragment = file?.fragments.find(item => item.sources.includes(sourceId) && (startLine === null ? item.startLine === null && endLine === null : endLine !== null && endLine >= startLine && item.startLine !== null && startLine >= item.startLine && endLine < item.startLine + item.lines.length))
    if (!fragment) throw new Error('Reference is not in the supplied current evidence')
    return { sourceId, path, fileVersion, startLine, endLine }
  })
}
export function observedText(context: ContextPacket, path: string, start: number, count: number): { value: string; evidence: EvidenceRef[] } | null {
  const file = context.files.find(item => item.path === path)
  if (!file) return null
  const lines = new Map<number, { text: string; fragment: typeof file.fragments[number] }>()
  for (const fragment of file.fragments) {
    if (fragment.startLine === null || fragment.confidence < 0.9) continue
    fragment.lines.forEach((text, index) => lines.set(fragment.startLine! + index, { text, fragment }))
  }
  const output: string[] = [], evidence: EvidenceRef[] = []
  for (let i = start; i < start + count; i++) {
    const entry = lines.get(i)
    if (!entry) return null
    output.push(entry.text)
    evidence.push({ sourceId: entry.fragment.sources.at(-1)!, path, fileVersion: file.fileVersion, startLine: i, endLine: i })
  }
  const compact: EvidenceRef[] = []
  for (const ref of evidence) {
    const previous = compact.at(-1)
    if (previous && previous.sourceId === ref.sourceId && previous.endLine! + 1 === ref.startLine) previous.endLine = ref.endLine
    else compact.push({ ...ref })
  }
  return { value: output.join('\n'), evidence: compact }
}
export function parseGuidance(raw: unknown, context: ContextPacket): Guidance {
  const root = object(raw, ['summary', 'look', 'patches', 'findings', 'verify', 'hypotheses'])
  const look = list(root.look, 3).map(value => {
    const item = object(value, ['path', 'startLine', 'endLine', 'symbol', 'reason'])
    const path = safePath(item.path)
    if (!context.knownPaths.includes(path)) throw new Error('Navigation target has not been observed')
    const startLine = item.startLine === null ? null : integer(item.startLine, 1, 100_000)
    const endLine = item.endLine === null ? null : integer(item.endLine, startLine ?? 1, 100_000)
    const symbol = text(item.symbol, 180)
    if (symbol && (!/^[A-Za-z_$][A-Za-z0-9_.$]*$/.test(symbol) || !context.files.some(file => file.fragments.some(part => part.lines.some(line => line.includes(symbol) || line.includes(symbol.split('.').at(-1)!)))))) throw new Error('Navigation symbol is not referenced in observed code')
    return { path, startLine, endLine, symbol, reason: text(item.reason, 600, true) } as Omit<Navigation, 'status' | 'requestedAfter'>
  })
  const patches: Patch[] = list(root.patches, 4).map((value, index) => {
    const item = object(value, ['path', 'fileVersion', 'startLine', 'before', 'after', 'reason'])
    const path = safePath(item.path), fileVersion = integer(item.fileVersion, 1), startLine = integer(item.startLine, 1, 100_000)
    const before = text(item.before, 6000, true), after = text(item.after, 6000)
    if (/\[REDACTED(?: SECRET)?\]/.test(before + after)) throw new Error('Redacted source cannot support an exact patch')
    if (before === after || before.includes('[REDACTED')) throw new Error('Patch must change visible non-secret code')
    const file = context.files.find(item => item.path === path && item.fileVersion === fileVersion)
    const observation = observedText(context, path, startLine, before.split('\n').length)
    if (!file || !observation || observation.value !== before) throw new Error('Patch preimage must match exact observed code')
    return { id: `patch-${hashText(`${context.contextKey}:${index}:${path}:${before}:${after}`)}`, path, fileVersion, startLine, before, after, reason: text(item.reason, 1000, true), evidence: observation.evidence }
  })
  for (let i = 0; i < patches.length; i++) for (let j = i + 1; j < patches.length; j++) {
    const a = patches[i], b = patches[j]
    if (a.path === b.path && a.startLine < b.startLine + b.before.split('\n').length && b.startLine < a.startLine + a.before.split('\n').length) throw new Error('Overlapping patch suggestions are ambiguous')
  }
  if (context.task.implementation === 'hold' && patches.length) throw new Error('Implementation is on hold; no patches may be proposed yet')
  const findings: Finding[] = list(root.findings, 8).map(value => {
    const item = object(value, ['severity', 'category', 'text', 'evidence'])
    if (!['blocking', 'review', 'optional'].includes(String(item.severity)) || !['correctness', 'scope', 'security', 'tests', 'readability'].includes(String(item.category))) throw new Error('Invalid finding')
    const evidence = refs(item.evidence, context)
    if (!evidence.length) throw new Error('Code findings must cite visible evidence')
    return { severity: item.severity as Finding['severity'], category: item.category as Finding['category'], text: text(item.text, 1200, true), evidence }
  })
  const verify = list(root.verify, 4).map(value => {
    const item = object(value, ['command', 'scope', 'reason'])
    const command = text(item.command, 500, true)
    if (/[\n\r;`]|\$\(|&&|\|\||\||>|<|\b(?:sudo|rm|del|curl|wget|powershell|invoke-webrequest|shutdown|format)\b/i.test(command)) throw new Error('Unsafe verification command')
    return { command, scope: text(item.scope, 300, true), reason: text(item.reason, 600, true) }
  })
  const hypotheses = list(root.hypotheses, 4).map(value => {
    const item = object(value, ['explanation', 'evidence'])
    return { explanation: text(item.explanation, 1000, true), evidence: refs(item.evidence, context) }
  })
  return { summary: text(root.summary, 2000, true), look, patches, findings, verify, hypotheses }
}
