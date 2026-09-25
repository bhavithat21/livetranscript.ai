import { describe, it, expect } from 'vitest'
import { createSession, makeEvent, reduceSession, exportSession, importSession, testMarker, safeVerifyCommand, canImport } from './policy'
import { anchorEdit, normalizeQuestion, observedLines, parseEvent, parsePlan, parseTestSummary, sourceBlocks, stampFor } from './engine'
import { compileContext, nextObservation, referenceGraph } from './context'
import { demoEvents, replayPrefix } from './fixtures'
import type { CodePlan, EventData, RepoSession } from './types'
import type { ScreenObservation } from '../screenEvidence'

const observation = (path = 'src/Service.ts', lines = ['function check(a, b) {', '  return a || b', '}'], startLine: number | null = 1, confidence = 1, eof = true): ScreenObservation => ({ files: [{ path, language: 'typescript', lines, startLine, confidence, endOfFile: eof }], visiblePaths: [path], terminal: '', requirements: [] })
const event = (s: RepoSession, data: EventData) => makeEvent(s, data, s.startedAt + s.seq + 1)
const apply = (s: RepoSession, data: EventData) => reduceSession(s, event(s, data))
function seen(s = createSession('test', 0), o = observation()) { return apply(s, { kind: 'observation', data: { observation: o, origin: 'fixture', activePath: o.files[0]?.path ?? null } }) }
function question(s: RepoSession, raw = 'How should this transition work?') { return apply(s, { kind: 'question', data: { id: String(s.seq), raw } }) }
const plan: CodePlan = { summary: 'Require both conditions.', navigation: { path: 'src/Service.ts', line: 2, symbol: '', reason: 'Inspect the predicate.' }, edits: [{ path: 'src/Service.ts', before: 'return a || b', after: 'return a && b', reason: 'Both conditions are required.' }], checks: [], verify: ['pnpm test'], missingEvidence: [] }
function planned(s = question(seen()), p = plan) { return apply(s, { kind: 'plan', data: { stamp: stampFor(s), plan: p, model: 'fixture', elapsedMs: 0 } }) }

describe('versioned repository session', () => {
  it('replays deterministically through the same reducer, including test attribution', () => {
    const f = demoEvents(), end = replayPrefix(f.events, f.events.length)
    expect(importSession(exportSession(end))).toEqual(end)
    expect(end.testRuns.at(-1)?.status).toBe('observed-pass')
    expect(end.edits[0].status).toBe('matched')
  })
  it('suppresses duplicate event delivery', () => { const s = createSession('s', 0), e = event(s, { kind: 'pause', data: { paused: true } }); const once = reduceSession(s, e); expect(reduceSession(once, e)).toBe(once) })
  it('rejects out of order and cross-session replay sequences', () => {
    const s = createSession('s', 0), e = event(s, { kind: 'pause', data: { paused: true } })
    expect(() => reduceSession(s, { ...e, seq: 2 })).toThrow()
    expect(reduceSession(s, { ...e, sessionId: 'another' })).toBe(s)
  })
  it('rejects unknown events and malformed observations', () => { expect(() => parseEvent({ schema: 1, sessionId: 's', seq: 1, at: 1, kind: 'execute', data: {} })).toThrow(); expect(() => seen(createSession('s', 0), observation('../secret'))).toThrow() })
  it('merges overlapping evidence without repeating lines', () => {
    let s = seen(createSession('s', 0), observation('a.ts', ['a', 'b', 'c'], 1, 1, false))
    s = seen(s, observation('a.ts', ['b', 'c', 'd'], 2))
    expect([...observedLines(s.snapshot.files[0]).values()].map(v => v.text)).toEqual(['a', 'b', 'c', 'd'])
    expect(sourceBlocks(s.snapshot.files[0])[0].text).toBe('a\nb\nc\nd')
    expect(observedLines(s.snapshot.files[0]).get(2)?.captures).toEqual([1, 2])
  })
  it('retires old anchors after conflicting code and invalidates old advice', () => {
    const s = planned(), oldStamp = stampFor(s)
    const changed = seen(s, observation('src/Service.ts', ['function check(a, b) {', '  return a && b', '}']))
    expect(changed.codeRevision).toBe(1)
    expect(changed.snapshot.files[0].staleFragments.length).toBeGreaterThan(0)
    const late = apply(changed, { kind: 'plan', data: { stamp: oldStamp, plan, model: 'fixture', elapsedMs: 10 } })
    expect(late.discardedResults).toBe(1)
  })
  it('does not claim complete code when a gutter is missing', () => { const s = seen(createSession('s', 0), observation('a.ts', ['return x'], null)); expect(anchorEdit(s.snapshot.files[0], 'return x')).toBeNull() })
  it('never promotes suggestions into observed code', () => { const s = planned(); expect(JSON.stringify(s.snapshot)).not.toContain('return a && b'); expect(s.edits).toHaveLength(1) })
  it('rejects missing and ambiguous patch preimages', () => {
    expect(planned(question(seen()), { ...plan, edits: [{ ...plan.edits[0], before: 'unseen code' }] }).edits).toHaveLength(0)
    const s = seen(createSession('s', 0), observation('src/Service.ts', ['return x', 'return x']))
    expect(anchorEdit(s.snapshot.files[0], 'return x')).toBeNull()
  })
  it('rejects uncertain source as an edit anchor', () => { expect(anchorEdit(seen(createSession('s', 0), observation('a.ts', ['return x'], 1, .4)).snapshot.files[0], 'return x')).toBeNull() })
  it('keeps requested navigation pending when the wrong file opens', () => { const s = seen(planned(), observation('Other.ts')); expect(s.navigation?.status).toBe('pending') })
  it('confirms a navigation target only when its requested region is seen', () => { const s = seen(planned()); expect(s.navigation?.status).toBe('observed') })
  it('removes unobserved line coordinates from navigation advice', () => { const s = planned(undefined, { ...plan, navigation: { ...plan.navigation!, line: 100 } }); expect(s.navigation?.line).toBeNull() })
  it('will not navigate to a hallucinated file', () => { expect(planned(undefined, { ...plan, navigation: { ...plan.navigation!, path: 'NeverSeen.ts' } }).navigation).toBeNull() })
  it('honors do-not-code instructions and invalidates pending suggestions', () => {
    let s = planned(); const old = stampFor(s)
    s = apply(s, { kind: 'utterance', data: { text: "Don't code yet. Explain first.", speaker: 'interviewer' } })
    expect(s.holdImplementation).toBe(true); expect(s.edits).toHaveLength(0)
    expect(s.evidenceRevision).toBeGreaterThan(old.evidenceRevision)
    expect(planned(s).edits).toHaveLength(0)
    s = apply(s, { kind: 'utterance', data: { text: 'Okay, implement it.', speaker: 'interviewer' } })
    expect(s.holdImplementation).toBe(false)
  })
  it('does not treat the candidate speaking as a new instruction', () => { const s = apply(planned(), { kind: 'utterance', data: { text: "Don't code yet", speaker: 'candidate' } }); expect(s.holdImplementation).toBe(false) })
  it('tracks API and dependency constraints without code execution', () => { const s = apply(question(seen()), { kind: 'utterance', data: { text: "Don't modify the public API. No external libraries.", speaker: 'interviewer' } }); expect(s.constraints).toHaveLength(2) })
  it('distinguishes an exact observed edit from verification', () => { const s = seen(planned(), observation('src/Service.ts', ['function check(a, b) {', '  return a && b', '}'])); expect(s.edits[0].status).toBe('matched'); expect(s.testRuns).toHaveLength(0) })
  it('flags a different implementation without asserting it is wrong', () => { const s = seen(planned(), observation('src/Service.ts', ['function check(a, b) {', '  return !(!a || !b)', '}'])); expect(s.edits[0].status).toBe('different'); expect(s.edits[0].note).toMatch(/operator|equivalent/i) })
  it('abstains on clipped edited regions', () => { const s = seen(planned(), observation('src/Service.ts', ['}'], 3)); expect(s.edits[0].status).toBe('not-visible') })
  it('does not recycle stale test success without a new run marker', () => {
    let s = apply(planned(), { kind: 'test-start', data: { command: 'pnpm test' } })
    s = seen(s, { files: [], visiblePaths: [], requirements: [], terminal: 'Tests: 4 passed, 4 total' })
    expect(s.testRuns.at(-1)?.status).toBe('waiting')
  })
  it('attributes a marked test output and invalidates it after another edit', () => {
    let s = apply(planned(), { kind: 'test-start', data: { command: 'pnpm test' } })
    s = seen(s, { files: [], visiblePaths: [], requirements: [], terminal: testMarker(s.testRuns[0].id) + '\nTests: 4 passed, 4 total' })
    expect(s.testRuns[0].status).toBe('observed-pass')
    s = seen(s, observation('src/Service.ts', ['return changed']))
    expect(s.testRuns[0].status).toBe('stale')
  })
  it('rejects completed speech after pause', () => { let s = question(seen()); const stamp = stampFor(s); s = apply(s, { kind: 'pause', data: { paused: true } }); s = apply(s, { kind: 'say', data: { stamp, text: 'Do this now', model: 'fixture', firstTokenMs: 1, elapsedMs: 2 } }); expect(s.say).toBeNull() })
  it('deduplicates equivalent question labels but retains the raw utterance', () => { const s = question(seen(), 'Speaker 1: So, why is this failing?'); expect(s.question?.text).toBe('why is this failing?'); expect(normalizeQuestion('Okay, what is authentication?')).toBe('what is authentication?') })
  it('marks inferred references as references, not proven calls', () => { const s = replayPrefix(demoEvents().events, 5); expect(referenceGraph(s).some(e => e.to.endsWith('TrackingService.ts') && e.kind === 'text-reference')).toBe(true) })
  it('preserves a strict context character budget', () => { const s = replayPrefix(demoEvents().events, 5); for (const b of [4000, 7000, 24000]) { expect(compileContext(s, b).characters).toBeLessThanOrEqual(b); expect(compileContext(s, b).estimatedTokens).toBeGreaterThan(0) } })
  it('offers only a known next observation', () => { const s = replayPrefix(demoEvents().events, 2), next = nextObservation(s); expect(s.snapshot.visiblePaths).toContain(next?.path) })
  it('rejects oversized or unknown replay formats', () => { expect(() => importSession('{"format":"execute-shell"}')).toThrow(); expect(() => importSession('x'.repeat(8000001))).toThrow() })
  it('does not export an incomplete event journal as a complete replay', () => { expect(() => exportSession({ ...planned(), journalTruncated: true })).toThrow() })
  it('validates model structured plans instead of trusting JSON shape', () => { expect(() => parsePlan({ ...plan, edits: [{ ...plan.edits[0], path: '../../x' }] })).toThrow(); expect(() => parsePlan({ ...plan, checks: [{ severity: 'all-good', text: 'x' }] })).toThrow() })
  it('restricts displayed verification commands and source imports', () => {
    expect(safeVerifyCommand('pnpm test -- TrackingService')).toBe(true)
    for (const cmd of ['curl https://example.com', 'npm install', 'pnpm test; rm -rf .', 'pnpm exec malicious']) expect(safeVerifyCommand(cmd)).toBe(false)
    expect(canImport('src/service.ts')).toBe(true)
    for (const path of ['.env', 'secret.key', 'node_modules/lib/x.ts', '../src/a.ts']) expect(canImport(path)).toBe(false)
  })
  it.each(['Tests: 4 passed, 4 total', '4 passed', 'Passed! - Failed: 0, Passed: 4'])('reads explicit test summary %s', text => expect(parseTestSummary(text)?.status).toBe('pass'))
  it('does not parse a code comment as test success', () => { expect(parseTestSummary('// 4 passed')).toBeNull() })
})
