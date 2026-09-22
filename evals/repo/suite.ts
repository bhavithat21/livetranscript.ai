import { createHash } from 'node:crypto'
import { repoAgentEvidence, repoAgentSystem } from '../../lib/repo/agentPrompts'
import type { RepoAgentRole } from '../../lib/repo/agentTypes'
import { repoBenchmarkFixtures, type RepoBenchmarkFixture } from './fixtures'

export const BENCHMARK_PURPOSES = ['requirements', 'navigation', 'implementation', 'debugger', 'reviewer', 'synthesis'] as const
export type BenchmarkPurpose = typeof BENCHMARK_PURPOSES[number]
export type ReviewCriterion = { id: string; description: string }
export const PURPOSES_FOR_ROLE: Record<RepoAgentRole, BenchmarkPurpose[]> = {
  requirements: ['requirements', 'navigation'], implementation: ['implementation'], debugger: ['debugger'], reviewer: ['reviewer'], synthesis: ['synthesis'],
}
export function roleForPurpose(purpose: BenchmarkPurpose): RepoAgentRole { return purpose === 'navigation' ? 'requirements' : purpose }

// Content hashes bind reviews to the exact measured source, prompt and answer.
// These are integrity checks, not attestations that an administrator ran a model.
export function digest(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
}

type AnswerKey = { questions: string; cause: string; patch: string; navigation: string; verification: string; limits: string }
const ANSWER_KEYS: Record<string, AnswerKey> = {
  'duplicate-cancellation-event': {
    questions: 'Address repeated cancellation, navigation, minimal change, concurrency, HTTP 200 compatibility and exactly one transition event.',
    cause: 'src/service/orders.ts:20-24 emits unconditionally after setStatus; sequential retries demonstrate duplicate side effects. Atomic transition semantics are absent.',
    patch: 'A sequential cancelled-state guard alone is insufficient under concurrency. Propose a conditional atomic transition and emit only when it succeeds, but inspect store/event semantics before prescribing a concrete storage patch; retain HTTP 200 on repeats.',
    navigation: 'Start src/service/orders.ts:20-24 and tests/orders.test.ts:41-42, then inspect repo.setStatus/events.emit definitions whose file paths are unknown. Do not invent a store filename.',
    verification: 'Request tests for sequential repeats, concurrent cancellation, shipped-state rejection and HTTP 200 repeats; never claim they were executed.',
    limits: 'Store, transaction and event-delivery semantics are absent. Exactly-once delivery across crash boundaries is not established.',
  },
  'conflicting-screen-captures': {
    questions: 'Address whether a fix is justified now and where to inspect next, keeping stale logs separate from current code.',
    cause: 'old1 and new2 disagree at src/cache.ts:18. Old condition looks reversed, but new condition may already fix it; current revision and rest of function are unknown.',
    patch: 'Do not apply a blind operator swap based on old1. Obtain a fresh capture of current src/cache.ts and current test output before a reliable patch.',
    navigation: 'Open src/cache.ts:1-40 and tests/cache.test.ts, then capture a fresh test run. No test line numbers have been observed.',
    verification: 'After confirming source, test unexpired entries, expired entries and equality boundary. Describe expected results rather than claiming success.',
    limits: 'Retain the conflicting captures and unknown current revision; do not reconstruct unseen lines.',
  },
  'multi-file-error-propagation': {
    questions: 'Explain why failures return 200, files requiring change, a minimal patch and tests, preserving body shape and no automatic payment retry.',
    cause: 'charge in src/payment.ts returns {ok:false,error} rather than throwing; src/route.ts:4 ignores result.ok and always sends 200.',
    patch: 'Use res.status(result.ok ? 200 : 502).json(result) in src/route.ts; no change to payment result shape or automatic retry is needed.',
    navigation: 'Trace src/route.ts:3-4 to src/payment.ts:1-3; inspect/update tests/route.test.ts:1-4. Do not assume an unobserved request helper implementation.',
    verification: 'Check failure 502 with the existing JSON body, success 200 and exactly one gateway call/no retry; test harness details beyond the excerpt are unknown.',
    limits: 'Complete source supports the minimal status patch; the test helper is not fully captured and tests were not run.',
  },
  'tenant-boundary': {
    questions: 'Address cross-tenant exposure, authenticated data flow, exact minimal fix and regressions; unknown and foreign IDs must both be 404.',
    cause: 'src/invoices/route.ts:2 queries only by id. store.ts:10-11 omits tenant filtering when tenantId is absent, allowing an application-level cross-tenant lookup.',
    patch: 'Pass {id:req.params.id,tenantId:session.tenantId} to findInvoice; preserve the 404 path. Never use a request-supplied tenant ID. Requiring tenantId in store is an optional defense, not a claim that unseen callers are compatible.',
    navigation: 'Open src/invoices/route.ts:2-4, src/invoices/store.ts:10-11 and tests/invoices.test.ts. Session contract is supplied; do not claim unseen middleware or row-level security.',
    verification: 'Same-tenant invoice succeeds, foreign invoice and missing ID produce the same 404 response, request tenant spoofing has no effect.',
    limits: 'SQL driver, row-level security and deployment configuration are unknown; avoid asserting proven external exploitability or absence of other controls.',
  },
  'stable-pagination': {
    questions: 'Explain skipped equal timestamps, stable ordering, compatible response, opaque cursor change and tests.',
    cause: 'src/feed.ts:3 filters only createdAt > after, dropping remaining rows at the same timestamp after a page boundary; sorting lacks the ID tie-break.',
    patch: 'Order by (createdAt,id), encode both in nextCursor, and use createdAt > cursor.createdAt OR equality plus id > cursor.id. Keep {items,nextCursor}; inspect any old cursor consumers before release.',
    navigation: 'Open src/feed.ts:1-4 and tests/feed.test.ts:1-4. Locate callers/persisted cursors by symbol search without inventing their paths.',
    verification: 'Test repeated timestamps across page boundaries, no skips/duplicates, ascending ID tie-break, empty results and cursor chaining.',
    limits: 'Numeric unique IDs and immutable integer timestamps are supplied; backward compatibility for existing opaque cursors is unknown.',
  },
  'stale-search-result': {
    questions: 'Explain stale overwrite, ignored AbortSignal, clear invalidation, unchanged fetcher API and deterministic tests.',
    cause: 'src/search.ts:6 always renders after await; abort is advisory and does not prevent A resolving after B or after clear.',
    patch: 'Introduce a generation token or request identity, capture it for each call and render only if still current; invalidate on clear. Preserve (query,signal) fetcher arguments. Abort alone is insufficient.',
    navigation: 'Open src/search.ts:2-10 and tests/search.test.ts; inspect callers for component ownership/error handling whose paths have not been captured.',
    verification: 'Use deferred promises: A then B, resolve B then A, only B renders; clear then late resolve must stay empty, including fetchers ignoring cancellation.',
    limits: 'UI ownership and error-display contract are missing; do not invent component state or swallow all failures without an explicit contract.',
  },
}

export function criteriaFor(fixture: RepoBenchmarkFixture, purpose: BenchmarkPurpose): ReviewCriterion[] {
  const key = ANSWER_KEYS[fixture.id]
  if (!key) throw new Error(`Missing answer key for ${fixture.id}`)
  const common = [
    { id: 'grounding', description: 'All repository claims and navigation cite supplied evidence; no fabricated files, lines, execution, successful tests or applied edits.' },
    { id: 'constraints', description: `${key.questions} Do not contradict these constraints.` },
    { id: 'uncertainty', description: key.limits },
  ]
  const selected: Record<BenchmarkPurpose, ReviewCriterion[]> = {
    requirements: [{ id: 'question-coverage', description: key.questions }, { id: 'fact-assumption-separation', description: 'Separate observed requirements, assumptions and unanswered questions; do not omit a sub-question.' }],
    navigation: [{ id: 'navigation', description: key.navigation }, { id: 'next-evidence', description: 'Give an ordered next navigation action and what it will resolve, with observed line ranges only.' }],
    implementation: [{ id: 'data-flow', description: key.cause }, { id: 'minimal-correct-change', description: key.patch }, { id: 'verification', description: key.verification }],
    debugger: [{ id: 'root-cause', description: key.cause }, { id: 'minimal-correct-change', description: key.patch }, { id: 'verification', description: key.verification }],
    reviewer: [{ id: 'evidence-supported-findings', description: key.cause }, { id: 'constraint-review', description: key.patch }, { id: 'missing-tests', description: key.verification }],
    synthesis: [{ id: 'root-cause', description: key.cause }, { id: 'minimal-correct-change', description: key.patch }, { id: 'navigation', description: key.navigation }, { id: 'verification', description: key.verification }, { id: 'reconciliation', description: 'Reject the deliberately incorrect specialist note against original evidence, disclose the failed reviewer, and include Say now / Questions captured / Navigate / Deep trace / Patch suggestion / Verification / Evidence sections.' }],
  }
  return [...common, ...selected[purpose]]
}

// Fixed notes isolate synthesis ability from other candidates' outputs. A bad
// implementation opinion and failed reviewer make blind consensus observable.
export function fixedSpecialistReports(fixture: RepoBenchmarkFixture) {
  const incorrectOpinions: Record<string, string> = {
    'duplicate-cancellation-event': 'src/service/orders.ts:21 already reads status. Add if (order.status === "cancelled") return before setStatus. This read-before-write guard guarantees one event even when two requests cancel concurrently, so no storage inspection is needed.',
    'conflicting-screen-captures': 'old1 shows src/cache.ts:18 has > instead of <=. Apply that operator swap immediately; the old terminal failure proves the current code is still broken. The rest of the function is not relevant.',
    'multi-file-error-propagation': 'Remove the catch in src/payment.ts and let gateway errors throw. Leave src/route.ts:4 unchanged; the framework will automatically return 502 with exactly the existing result body. Retry once to improve reliability.',
    'tenant-boundary': 'Add tenantId: req.query.tenantId to the findInvoice call at src/invoices/route.ts:2. The tenant filter then prevents cross-tenant reads, and authenticated clients can supply their own tenant ID.',
    'stable-pagination': 'Change src/feed.ts:3 from createdAt > after to createdAt >= after. This preserves the numeric cursor and prevents any skipped or duplicated rows; the original timestamp-only sort can stay.',
    'stale-search-result': 'src/search.ts:3 already aborts the old request. Add activeController = undefined in clear; no generation check is needed because abort guarantees the earlier promise cannot resolve. This also handles clear followed by a late result.',
  }
  return [
    { role: 'requirements', status: 'done', model: 'fixed-fixture-note', text: ANSWER_KEYS[fixture.id].questions },
    { role: fixture.input.task === 'debug' ? 'debugger' : 'implementation', status: 'done', model: 'fixed-fixture-note', text: incorrectOpinions[fixture.id] },
    { role: 'reviewer', status: 'failed', model: 'fixed-fixture-note', text: 'Independent review failed: fixture simulates a provider timeout.' },
  ]
}

export function benchmarkRequest(fixture: RepoBenchmarkFixture, purpose: BenchmarkPurpose) {
  const system = repoAgentSystem(roleForPurpose(purpose))
  const evidence = purpose === 'synthesis'
    ? JSON.stringify({ sourceEvidence: JSON.parse(repoAgentEvidence(fixture.input)), specialistReports: fixedSpecialistReports(fixture) })
    : repoAgentEvidence(fixture.input)
  return { system, evidence }
}

export function suiteManifest() {
  const cases = repoBenchmarkFixtures.map((fixture) => ({
    id: fixture.id, input: fixture.input, sourceSha256: digest(fixture.input),
    purposes: Object.fromEntries(BENCHMARK_PURPOSES.map((purpose) => [purpose, { criteria: criteriaFor(fixture, purpose), ...benchmarkRequest(fixture, purpose) }])),
  }))
  return { id: 'repository-purpose-v2', description: 'Six synthetic partial-source scenarios, exact production prompts; synthesis uses fixed specialist notes. No screenshot OCR or generated-code execution.', sha256: digest(cases), cases }
}
