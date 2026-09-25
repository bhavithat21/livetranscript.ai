import { createSession, makeEvent, reduceRepoEvent, stampFor } from './engine'
import type { CodePlan, EventData, RepoEvent, RepoSession } from './types'
import type { ScreenObservation } from '../screenEvidence'

/** Public synthetic data only. No captured interview, private code, or expected answer is sent to a provider. */
export function demoEvents(): { initial: RepoSession; events: RepoEvent[] } {
  const initial = createSession('synthetic-order-transition', 1000)
  let s = initial
  const events: RepoEvent[] = []
  function add(data: EventData) { const event = makeEvent(s, data, 1000 + (s.seq + 1) * 1000); s = reduceRepoEvent(s, event); events.push(event) }
  const files = ['src/OrderController.ts', 'src/OrderService.ts', 'src/TrackingService.ts', 'test/TrackingService.test.ts']
  function capture(path: string, lines: string[], terminal = '') {
    const observation: ScreenObservation = { files: lines.length ? [{ path, language: 'typescript', startLine: 1, lines, confidence: 1, endOfFile: true }] : [], visiblePaths: files, terminal, requirements: ['Only PROCESSING to SHIPPED is a valid shipment transition. Preserve the public API.'] }
    add({ kind: 'observation', data: { observation, origin: 'fixture', activePath: lines.length ? path : null } })
  }
  add({ kind: 'question', data: { id: 'fixture-question', raw: 'Why is the cancelled-order transition accepted? Explain the approach, then fix the smallest responsible change.' } })
  capture('src/OrderController.ts', ["import { updateOrder } from './OrderService'", 'export function update(current: string, next: string) {', '  return updateOrder(current, next)', '}'])
  add({ kind: 'say', data: { stamp: stampFor(s), text: 'I’ll trace the transition from the controller into the domain logic, reproduce the rejected-state case, and keep the change limited to that condition.', model: 'synthetic replay — not model inference', firstTokenMs: null, elapsedMs: 0 } })
  capture('src/OrderService.ts', ["import { canTransition } from './TrackingService'", 'export function updateOrder(current: string, next: string) {', '  if (!canTransition(current, next)) throw new Error("Invalid transition")', '  return next', '}'])
  const before = "return current === 'PROCESSING' || next === 'SHIPPED'", after = "return current === 'PROCESSING' && next === 'SHIPPED'"
  capture('src/TrackingService.ts', ['export function canTransition(current: string, next: string) {', '  ' + before, '}'])
  const plan: CodePlan = { summary: 'The observed OR condition accepts a cancelled order whenever the target is SHIPPED. The requirement needs both sides of the transition to match.', navigation: { path: 'src/TrackingService.ts', line: 2, symbol: 'canTransition', reason: 'Inspect the transition predicate and its boundary tests.' }, edits: [{ path: 'src/TrackingService.ts', before, after, reason: 'Require the current status and requested next status together.' }], checks: [{ severity: 'important', text: 'Cover CANCELLED → SHIPPED and PROCESSING → CANCELLED as rejected transitions.' }, { severity: 'optional', text: 'Keep the existing public signature; a larger state-machine refactor is unnecessary for this task.' }], verify: ['pnpm test -- TrackingService'], missingEvidence: ['Inspect the boundary tests before treating this as verified.'] }
  add({ kind: 'plan', data: { stamp: stampFor(s), plan, model: 'synthetic replay — not model inference', elapsedMs: 0 } })
  capture('src/OrderService.ts', ['// Wrong file opened: navigation must remain pending.'])
  capture('src/TrackingService.ts', ['export function canTransition(current: string, next: string) {', "  return current === 'PROCESSING' || next === 'CANCELLED'", '}'])
  capture('src/TrackingService.ts', ['export function canTransition(current: string, next: string) {', '  ' + after, '}'])
  // Explicit test-start is necessary: a success string in an old screenshot is not evidence for a new edit.
  add({ kind: 'test-start', data: { command: 'pnpm test -- TrackingService' } })
  capture('', [], 'Tests: 4 passed, 4 total\nTime: 0.12s')
  return { initial, events }
}
export function replayPrefix(events: RepoEvent[], count: number): RepoSession {
  let state = createSession(events[0]?.sessionId ?? 'empty-fixture', 1000)
  for (const event of events.slice(0, count)) state = reduceRepoEvent(state, event)
  return state
}
