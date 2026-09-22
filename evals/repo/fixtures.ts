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
  {
    id: 'tenant-boundary',
    input: {
      task: 'review', question: 'Can one customer read another tenant’s invoice? Show the data flow, exact fix, and regression tests.',
      transcript: 'Keep unknown IDs and other tenants’ IDs indistinguishable: both return 404. The tenant comes from the authenticated session, never request input.',
      context: `OBSERVED src/invoices/route.ts lines 1-7, complete handler:
1 export async function get(req, res, session, db) {
2   const invoice = await db.findInvoice({ id: req.params.id })
3   if (!invoice) return res.status(404).json({ error: 'not found' })
4   return res.status(200).json(invoice)
5 }
OBSERVED src/invoices/store.ts lines 10-15, complete method:
10 export async function findInvoice({ id, tenantId }) {
11   return sql.first('invoices', { id, ...(tenantId ? { tenantId } : {}) })
12 }
OBSERVED src/auth/session.ts contract: session.tenantId is a nonempty authenticated tenant identifier; this route is entered only after authentication.
OBSERVED tests/invoices.test.ts: fixtures invoice A owned by tenant alpha, invoice B owned by tenant beta.
UNKNOWN: SQL driver behavior, row-level security and deployment configuration are not supplied.`,
    },
    expectedPaths: ['src/invoices/route.ts', 'src/invoices/store.ts', 'tests/invoices.test.ts'],
    requiredConcepts: [/tenantId/, /404/, /session|authenticated/i], missingEvidence: true,
  },
  {
    id: 'stable-pagination',
    input: {
      task: 'plan', question: 'Why are records lost between pages when timestamps match? Explain the ordering, minimal compatible fix, and tests.',
      transcript: 'Rows have unique numeric IDs and immutable integer createdAt values. Preserve ascending order and the response shape { items, nextCursor }. You may change the opaque cursor format.',
      context: `OBSERVED src/feed.ts lines 1-12, complete file:
1 export function page(rows, after, limit) {
2   const sorted = [...rows].sort((a, b) => a.createdAt - b.createdAt)
3   const items = sorted.filter(row => after == null || row.createdAt > after).slice(0, limit)
4   return { items, nextCursor: items.at(-1)?.createdAt ?? null }
5 }
OBSERVED tests/feed.test.ts lines 1-7:
1 const rows = [{id: 1, createdAt: 10}, {id: 2, createdAt: 10}, {id: 3, createdAt: 11}]
2 const first = page(rows, null, 1)
3 const second = page(rows, first.nextCursor, 1)
4 expect(second.items[0].id).toBe(2)
OBSERVED terminal: second.items[0].id was 3.
UNKNOWN: any persisted cursors or external callers; before shipping, inspect callers for old cursor compatibility.`,
    },
    expectedPaths: ['src/feed.ts', 'tests/feed.test.ts'],
    requiredConcepts: [/createdAt/, /\bid\b/, /cursor|tie|lexicograph/i], missingEvidence: true,
  },
  {
    id: 'stale-search-result',
    input: {
      task: 'debug', question: 'Why does the old search overwrite the new search? How should cancellation and late completion be handled, and how can we test it?',
      transcript: 'Keep the current fetcher interface. A request may ignore AbortSignal and still complete. Clearing the search must also invalidate any in-flight result.',
      context: `OBSERVED src/search.ts lines 1-15, complete module:
1 let activeController
2 export async function search(query, fetcher, render) {
3   activeController?.abort()
4   activeController = new AbortController()
5   const result = await fetcher(query, activeController.signal)
6   render(result)
7 }
8 export function clear(render) {
9   activeController?.abort()
10  render([])
11 }
OBSERVED tests/search.test.ts: controlled deferred promises; request A starts, request B starts, B resolves, then A resolves; rendered result becomes A.
UNKNOWN: component ownership and error-display contract; no UI file or existing error handler is supplied.`,
    },
    expectedPaths: ['src/search.ts', 'tests/search.test.ts'],
    requiredConcepts: [/generation|sequence|token|current|identity|requestId/i, /clear/, /abort|cancel/i], missingEvidence: true,
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
