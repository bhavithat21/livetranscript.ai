import type { RepoAgentInput } from '../../lib/repo/agentTypes'

export type RepoBenchmarkFixture = { id: string; input: RepoAgentInput; expectedPaths: string[]; requiredConcepts: RegExp[]; missingEvidence: boolean }

// Partial-repo fixtures deliberately include gaps: a strong answer needs to
// distinguish a supported patch from a request to inspect more source.
export const repoBenchmarkFixtures: RepoBenchmarkFixture[] = [
  {
    id: 'duplicate-cancellation-event',
    input: {
      task: 'debug',
      question: 'Why does retrying cancellation emit twice? Where should I navigate, what should I change, and how would concurrent cancellation behave?',
      transcript: 'Cancellation must be idempotent. Emit one event only for a successful transition. Keep the API returning 200 for repeated cancellation.',
      context: `OBSERVED src/api/orders.ts lines 12-16:
12 export async function cancel(req, res) {
13   await service.cancel(req.params.id)
14   res.status(200).end()
15 }
OBSERVED src/service/orders.ts lines 20-26:
20 export async function cancel(id) {
21   const order = await repo.get(id)
22   if (order.status === 'shipped') throw new Error('invalid state')
23   await repo.setStatus(id, 'cancelled')
24   await events.emit('cancelled', { id })
25 }
OBSERVED tests/orders.test.ts lines 41-42:
41 await cancel('A'); await cancel('A')
42 expect(events.count('cancelled')).toBe(1)
OBSERVED terminal: FAIL tests/orders.test.ts expected 1 received 2
UNKNOWN: repo.setStatus and events.emit implementation, transaction semantics and schema are not captured.`,
    },
    expectedPaths: ['src/service/orders.ts', 'tests/orders.test.ts'],
    requiredConcepts: [/idempoten|repeat|duplicate|retry/i, /atomic|conditional|compare.and.swap|transaction|concurren/i, /emit|event/i],
    missingEvidence: true,
  },
  {
    id: 'conflicting-screen-captures',
    input: {
      task: 'review', question: 'Can I apply a fix now? Where should I look next?', transcript: 'The test fails but I changed the function recently.',
      context: `SCREEN EVIDENCE (partial, not an executable clone):
Capture old1 src/cache.ts line 18: if (entry.expiresAt > now) return undefined
Capture new2 src/cache.ts line 18: if (entry.expiresAt <= now) return undefined
CONFLICT: line 18 changed between captures; rest of function not captured. current editor revision unknown.
VISIBLE TREE ONLY: src/cache.ts, tests/cache.test.ts
terminal snapshot from old1: FAIL expected cached value received undefined
UNKNOWN: current src/cache.ts lines 1-40; current test output.`,
    },
    expectedPaths: ['src/cache.ts', 'tests/cache.test.ts'],
    requiredConcepts: [/conflict|changed|stale|revision/i, /capture|inspect|open|current/i],
    missingEvidence: true,
  },
  {
    id: 'multi-file-error-propagation',
    input: {
      task: 'plan', question: 'Why do failed payments return HTTP 200? Which files need to change? Give a minimal fix and test plan.', transcript: 'Preserve the current response shape. Do not retry payments automatically.',
      context: `OBSERVED src/payment.ts lines 1-5, complete file:
1 export async function charge(gateway, amount) {
2   try { await gateway.charge(amount); return { ok: true } }
3   catch { return { ok: false, error: 'payment failed' } }
4 }
OBSERVED src/route.ts lines 1-6, complete file:
1 import { charge } from './payment'
2 export async function post(req, res, gateway) {
3   const result = await charge(gateway, req.body.amount)
4   res.status(200).json(result)
5 }
OBSERVED tests/route.test.ts lines 1-4, partial:
1 it('returns failure status', async () => {
2   const gateway = { charge: () => Promise.reject(new Error('declined')) }
3   const response = await request(gateway)
4   expect(response.status).toBe(502)
REQUIREMENT: downstream failure returns 502 with existing JSON body; success remains 200.`,
    },
    expectedPaths: ['src/route.ts', 'src/payment.ts'],
    requiredConcepts: [/502/, /result\.ok|ok.*false|ok.*status|conditional/i, /test|assert|expect/i],
    missingEvidence: false,
  },
]

export type RepoBenchmarkScore = { pathCoverage: number; conceptCoverage: number; preservesUnknowns: boolean; noExecutionClaim: boolean; proxyScore: number }
export function scoreRepoBenchmark(fixture: RepoBenchmarkFixture, text: string): RepoBenchmarkScore {
  const pathCoverage = fixture.expectedPaths.filter((path) => text.includes(path)).length / fixture.expectedPaths.length
  const conceptCoverage = fixture.requiredConcepts.filter((pattern) => pattern.test(text)).length / fixture.requiredConcepts.length
  const preservesUnknowns = !fixture.missingEvidence || /unknown|not (?:captured|visible|provided)|missing|cannot confirm|need.{0,40}(?:inspect|capture|implementation)|uncertain/i.test(text)
  const noExecutionClaim = !/\b(?:I|we) (?:have )?(?:ran|executed|verified|applied)|\ball tests (?:pass|passed)\b/i.test(text)
  return { pathCoverage, conceptCoverage, preservesUnknowns, noExecutionClaim, proxyScore: (pathCoverage + conceptCoverage + Number(preservesUnknowns) + Number(noExecutionClaim)) / 4 }
}
