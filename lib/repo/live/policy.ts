import { createSession, makeEvent, parseEvent, parseTestSummary, reduceRepoEvent as reduceCore, MAX_EVENTS, MAX_REPLAY_BYTES, safePath } from './engine'
import type { RepoEvent, RepoSession } from './types'
export { createSession, makeEvent }
export function testMarker(id: string): string { return 'LT_RUN_' + id.replace(/[^a-zA-Z0-9]/g, '_') }
/** Safety policy shared by live observation and offline replay. */
export function reduceSession(previous: RepoSession, raw: RepoEvent): RepoSession {
  const event = parseEvent(raw)
  if (event.sessionId !== previous.id || event.seq <= previous.seq) return previous
  let next = reduceCore(previous, event)
  if (next.holdImplementation !== previous.holdImplementation || JSON.stringify(next.constraints) !== JSON.stringify(previous.constraints)) next = { ...next, evidenceRevision: next.evidenceRevision + 1, say: null, plan: null }
  if (event.kind === 'plan' && next.navigation?.status === 'pending') {
    const n = next.navigation, file = next.snapshot.files.find(f => f.path === n.path)
    const seenLine = n.line !== null && file?.fragments.some(f => f.startLine !== null && n.line! >= f.startLine && n.line! < f.startLine + f.lines.length && f.confidence >= .9)
    if (n.line !== null && !seenLine) next = { ...next, navigation: { ...n, line: null } }
    if (next.plan) next = { ...next, plan: { ...next.plan, verify: next.plan.verify.filter(safeVerifyCommand) } }
  }
  if (event.kind === 'observation') next = { ...next, testRuns: next.testRuns.map(run => {
    const old = previous.testRuns.find(r => r.id === run.id)
    if (!old || old.status !== 'waiting' || run.status === 'stale' || event.at <= run.startedAt) return run
    const terminal = event.data.observation.terminal, marker = testMarker(run.id)
    // Require a marker on its OWN line, not a shell prompt containing an echo
    // command, and only parse output AFTER it. This remains visual evidence.
    const lines = terminal.split('\n'), index = lines.findLastIndex(l => l.trim() === marker)
    if (index < 0 || old.initialTerminal.split('\n').some(l => l.trim() === marker)) return run
    const output = lines.slice(index + 1).join('\n'), result = parseTestSummary(output)
    if (!result) return run
    return { ...run, status: result.status === 'pass' ? 'observed-pass' : 'observed-fail', output, passed: result.passed, failed: result.failed }
  }) }
  let journal = next.events
  let bytes = journal.reduce((total, e) => total + new TextEncoder().encode(JSON.stringify(e)).byteLength, 0)
  while (bytes > MAX_REPLAY_BYTES - 2000 && journal.length) { bytes -= new TextEncoder().encode(JSON.stringify(journal[0])).byteLength; journal = journal.slice(1) }
  if (journal.length !== next.events.length) next = { ...next, events: journal, journalTruncated: true }
  return next
}
export function exportSession(s: RepoSession): string {
  if (s.journalTruncated) throw new Error('The session exceeded the replay budget. Start a shorter session for a complete recording.')
  const text = JSON.stringify({ format: 'livetranscript-repo-replay-v1', sessionId: s.id, startedAt: s.startedAt, events: s.events }, null, 2)
  if (new TextEncoder().encode(text).byteLength > MAX_REPLAY_BYTES) throw new Error('Replay exceeds 8 MB')
  return text
}
export function importSession(text: string): RepoSession {
  if (new TextEncoder().encode(text).byteLength > MAX_REPLAY_BYTES) throw new Error('Replay exceeds 8 MB')
  const value = JSON.parse(text)
  if (!value || value.format !== 'livetranscript-repo-replay-v1' || typeof value.sessionId !== 'string' || value.sessionId.length > 100 || !Number.isSafeInteger(value.startedAt) || value.startedAt < 0 || !Array.isArray(value.events) || value.events.length > MAX_EVENTS) throw new Error('Invalid replay')
  let s = createSession(value.sessionId, value.startedAt)
  for (const raw of value.events) { const e = parseEvent(raw); if (e.sessionId !== s.id || e.seq !== s.seq + 1) throw new Error('Replay identity or sequence mismatch'); s = reduceSession(s, e) }
  return s
}
/** Restricts suggestions; no command is executed by the application. */
export function safeVerifyCommand(command: string): boolean {
  return command.length <= 500 && !/[\n\r;&|`$<>]/.test(command) && /^(?:(?:pnpm|npm|yarn)\s+(?:test|typecheck|lint|build)|pytest|python(?:3)?\s+-m\s+(?:pytest|unittest)|mvn\s+(?:test|verify|compile)|(?:gradle|\.\/gradlew)\s+(?:test|check|build)|dotnet\s+(?:test|build)|go\s+test|cargo\s+test|npx\s+(?:vitest|jest|tsc))\b/.test(command) && !/\b(?:install|publish|deploy|delete|remove|exec|curl|wget|https?)\b/i.test(command)
}
export function canImport(path: string): boolean { return safePath(path) && /\.(?:ts|tsx|js|jsx|mjs|py|java|cs|go|rs|json|md|yml|yaml|toml|xml|sql)$/.test(path) && !/(^|\/)(?:node_modules|\.git|dist|build|vendor)\//.test(path) }
