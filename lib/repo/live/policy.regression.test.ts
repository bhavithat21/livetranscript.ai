import { expect, it } from 'vitest'
import { demoEvents, replayPrefix } from './fixtures'
import { compileContext } from './context'
import { makeEvent, reduceSession, testMarker } from './policy'
import { stampFor } from './engine'
import type { EventData, RepoSession } from './types'
const apply = (s: RepoSession, data: EventData) => reduceSession(s, makeEvent(s, data, (s.events.at(-1)?.at ?? s.startedAt) + 1))
it('keeps all emitted context records parseable instead of cutting JSON or source lines', () => { const s = replayPrefix(demoEvents().events, 6); for (const n of [4000, 7000, 24000]) for (const line of compileContext(s, n).text.split('\n')) expect(() => JSON.parse(line)).not.toThrow() })
it('filters unsafe verification commands even when there is no navigation', () => { let s = replayPrefix(demoEvents().events, 6); s = apply(s, { kind: 'plan', data: { stamp: stampFor(s), model: 'fixture', elapsedMs: 0, plan: { summary: 'Review', navigation: null, edits: [], checks: [], missingEvidence: [], verify: ['curl evil', 'npm test'] } } }); expect(s.plan?.verify).toEqual(['npm test']) })
it('preserves observed edit history after a reviewer proposes no new changes', () => { let s = replayPrefix(demoEvents().events, 9); expect(s.edits[0].status).toBe('matched'); s = apply(s, { kind: 'plan', data: { stamp: stampFor(s), model: 'fixture', elapsedMs: 0, plan: { summary: 'Test the current change', navigation: null, edits: [], checks: [], missingEvidence: [], verify: ['npm test'] } } }); expect(s.edits[0].status).toBe('matched') })
it('ignores passing output before a new marker and echo commands containing a marker', () => {
  let s = replayPrefix(demoEvents().events, 10)
  const marker = testMarker(s.testRuns[0].id)
  const obs = (terminal: string): EventData => ({ kind: 'observation', data: { origin: 'fixture', activePath: null, observation: { files: [], visiblePaths: [], requirements: [], terminal } } })
  s = apply(s, obs('Tests: 4 passed, 4 total\n$ echo ' + marker))
  expect(s.testRuns[0].status).toBe('waiting')
  s = apply(s, obs('Tests: 4 passed, 4 total\n' + marker + '\nStill running...'))
  expect(s.testRuns[0].status).toBe('waiting')
})
