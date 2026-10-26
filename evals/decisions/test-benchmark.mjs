import test from 'node:test'
import assert from 'node:assert/strict'
import { CASES } from './cases.mjs'
import { endpointUrl, validateCase, requestFor, parseDecision, runBenchmark, summarize, main } from './benchmark.mjs'

const item = CASES[0]
const labels = validateCase(item)
function payload(fixture = item, selected = fixture.expected) {
  const keys = validateCase(fixture)
  return { model: 'stub-fixture-not-a-real-model', answers: { decision: {
    type: 'choice', choice: selected, confidence: 0.99,
    probabilities: Object.fromEntries(keys.map(key => [key, Number(key === selected)])),
  } } }
}
const config = { url: 'http://127.0.0.1:8000/v1/systemone', model: 'fixture', token: '', repetitions: 1, timeoutMs: 100 }

test('all 15 smoke fixtures are valid and have unique ids', () => {
  assert.equal(CASES.length, 15)
  assert.equal(new Set(CASES.map(row => row.id)).size, 15)
  CASES.forEach(validateCase)
})
test('expected answers and fixture annotations cannot leak into the request', () => {
  const input = { ...item, expected: 'general', notes: 'secret rubric', output: 'gold answer' }
  const request = requestFor(input, 'english')
  assert.deepEqual(Object.keys(request).sort(), ['model', 'questions', 'state'])
  assert.equal(JSON.stringify(request).includes('secret rubric'), false)
  assert.equal(JSON.stringify(request).includes('gold answer'), false)
  assert.equal(JSON.stringify(request).includes('expected'), false)
})
test('missing model identity is rejected before sending', () => assert.throws(() => requestFor(item, ' ')))
test('malformed fixtures fail before inference', () => {
  for (const bad of [null, { ...item, expected: 'inexistent' }, { ...item, state: 'x'.repeat(6001) }, { ...item, question: { ...item.question, criteria: [] } }]) {
    assert.throws(() => validateCase(bad))
  }
})
test('secure HTTPS and literal loopback endpoints are accepted', () => {
  for (const value of ['https://models.example/v1/systemone', config.url, 'http://[::1]:8000/v1/systemone']) assert.ok(endpointUrl(value))
})
for (const [label, value] of Object.entries({
  remote_http: 'http://models.example/v1/systemone', local_hostname_http: 'http://localhost:8000/v1/systemone',
  embedded_key: 'https://secret@models.example/v1/systemone', query: 'https://models.example/v1/systemone?token=secret',
  fragment: 'https://models.example/v1/systemone#secret', wrong_path: 'https://models.example/admin', wrong_protocol: 'ftp://127.0.0.1/v1/systemone',
})) test(`endpoint rejects ${label}`, () => assert.throws(() => endpointUrl(value)))

test('strict choice parser accepts a known label with a normalized distribution', () => assert.equal(parseDecision(payload(), labels).choice, item.expected))
for (const [name, mutate] of Object.entries({
  unknown_choice: p => { p.answers.decision.choice = 'invented' },
  wrong_type: p => { p.answers.decision.type = 'score' },
  missing_model: p => { delete p.model },
  missing_option: p => { delete p.answers.decision.probabilities.general },
  extra_option: p => { p.answers.decision.probabilities.injected = 0 },
  nonfinite: p => { p.answers.decision.probabilities.general = Infinity },
  negative: p => { p.answers.decision.probabilities.general = -0.1 },
  not_normalized: p => { p.answers.decision.probabilities.general = 0.5 },
  not_argmax: p => { p.answers.decision.choice = 'coding' },
})) test(`response rejects ${name}`, () => { const p = payload(); mutate(p); assert.throws(() => parseDecision(p, labels)) })

test('vendor confidence is never treated as calibrated correctness', () => {
  const a = payload(), b = payload(); a.answers.decision.confidence = 0; b.answers.decision.confidence = 1
  assert.deepEqual(parseDecision(a, labels), parseDecision(b, labels))
  assert.equal(Object.hasOwn(parseDecision(a, labels), 'confidence'), false)
})
test('plan mode makes zero network requests and explicitly says not-run', async t => {
  let text = ''
  t.mock.method(console, 'log', value => { text += value })
  const transport = t.mock.method(globalThis, 'fetch', () => { throw new Error('No network allowed') })
  await main(['--plan'], {})
  assert.equal(transport.mock.callCount(), 0)
  assert.equal(JSON.parse(text).status, 'not-run')
})
test('live invocation requires explicit approval even when endpoint and token exist', async () => {
  await assert.rejects(main(['--live'], { DECISION_BENCHMARK_URL: config.url, DECISION_BENCHMARK_TOKEN: 'not-a-real-key' }), /Review/)
})
test('unknown CLI flags fail rather than enabling execution', async () => assert.rejects(main(['--everything'], {}), /Usage/))
test('explicit bounded repetitions make one request per fixture and never auto-retry', async () => {
  let count = 0
  const report = await runBenchmark([item], { ...config, repetitions: 3 }, async (_url, options) => {
    count++
    assert.equal(options.redirect, 'error')
    assert.equal(options.cache, 'no-store')
    assert.equal(JSON.parse(options.body).expected, undefined)
    return Response.json(payload())
  })
  assert.equal(count, 3)
  assert.equal(report.summary.correct, 3)
  assert.equal(report.summary.meanMulticlassBrier, 0)
  assert.equal(report.provenance.hardware, 'not supplied')
  assert.match(report.note, /not a held-out/)
})
test('authorization uses only the token explicitly supplied for that endpoint', async () => {
  await runBenchmark([item], { ...config, token: 'fixture-key' }, async (_url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer fixture-key')
    return Response.json(payload())
  })
})
test('errors count against total accuracy and are not quietly dropped', async () => {
  const report = await runBenchmark([item], config, async () => new Response('private provider detail fixture-key', { status: 429 }))
  assert.equal(report.summary.errors, 1)
  assert.equal(report.summary.accuracyIncludingErrors, 0)
  assert.equal(report.rows[0].reason, 'http_429')
  assert.equal(JSON.stringify(report).includes('private provider'), false)
  assert.equal(JSON.stringify(report).includes('fixture-key'), false)
})
test('transport exceptions are sanitized', async () => {
  const report = await runBenchmark([item], config, async () => { throw new Error('private utterance secret-key') })
  assert.equal(report.summary.errors, 1)
  assert.equal(JSON.stringify(report).includes('secret-key'), false)
})
test('timeouts abort and do not retry', async () => {
  let count = 0
  const report = await runBenchmark([item], { ...config, timeoutMs: 50 }, (_url, options) => new Promise((_resolve, reject) => {
    count++; options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
  }))
  assert.equal(count, 1)
  assert.equal(report.rows[0].reason, 'timeout')
})
test('oversized responses fail closed', async () => {
  const report = await runBenchmark([item], config, async () => new Response('x'.repeat(129 * 1024)))
  assert.equal(report.summary.errors, 1)
})
test('abstention coverage is separate from overall and selective accuracy', async () => {
  const report = await runBenchmark([item], config, async () => Response.json(payload(item, 'need_more_evidence')))
  assert.equal(report.summary.abstentions, 1)
  assert.equal(report.summary.decidedCoverage, 0)
  assert.equal(report.summary.accuracyWhenDecided, null)
  assert.equal(report.summary.accuracyIncludingErrors, 0)
})
test('supported abstentions can be correct without inflating decided coverage', async () => {
  const fixture = CASES.find(row => row.id === 'do-not-invent-file')
  const report = await runBenchmark([fixture], config, async () => Response.json(payload(fixture)))
  assert.equal(report.summary.correct, 1)
  assert.equal(report.summary.decidedCoverage, 0)
})
test('empty metric sets are not reported as perfect scores', () => {
  assert.equal(summarize([]).accuracyIncludingErrors, null)
  assert.equal(summarize([]).requestP95Ms, null)
})
test('invalid run budgets and header injection are rejected', async () => {
  for (const changed of [{ repetitions: 0 }, { repetitions: 4 }, { timeoutMs: 10001 }, { token: 'x\r\nX-Evil: yes' }]) {
    await assert.rejects(runBenchmark([item], { ...config, ...changed }, () => { throw new Error('Must not fetch') }))
  }
})
