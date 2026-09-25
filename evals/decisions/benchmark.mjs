/** Offline-safe, advisory-only benchmark for Jev-compatible decision endpoints.
 * This module is NOT imported by the application. No production routing changes.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CASES } from './cases.mjs'

const MAX_RESPONSE_BYTES = 128 * 1024
const PROBABILITY_TOLERANCE = 0.01
export const EVIDENCE_NOTE = 'Public synthetic smoke cases, not a held-out quality benchmark. No screenshot extraction, ASR, code generation, or code execution is measured.'

export function endpointUrl(value) {
  const url = new URL(value)
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.username || url.password || url.search || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) ||
      !/^\/v1\/systemone\/?$/.test(url.pathname)) {
    throw new Error('Use an HTTPS /v1/systemone endpoint, or literal loopback HTTP. Credentials, query strings and fragments are forbidden.')
  }
  return url.href
}

export function validateCase(item) {
  if (!item || typeof item.id !== 'string' || typeof item.category !== 'string' ||
      typeof item.state !== 'string' || item.state.length > 6000 ||
      item.question?.type !== 'choice' || typeof item.question.instructions !== 'string') {
    throw new Error('Invalid decision case')
  }
  const criteria = item.question.criteria
  if (!criteria || typeof criteria !== 'object' || Array.isArray(criteria)) throw new Error('Missing criteria')
  const labels = Object.keys(criteria)
  if (labels.length < 2 || labels.length > 8 || !labels.includes(item.expected) ||
      !Object.values(criteria).every(v => typeof v === 'string')) throw new Error('Invalid choices or expected label')
  return labels
}

export function requestFor(item, model) {
  validateCase(item)
  if (typeof model !== 'string' || !model.trim()) throw new Error('An explicit model is required')
  // Build the allowlisted request; never spread the fixture into a model request.
  // Ground truth, category and test id are held out from generation.
  return { model, state: item.state, questions: { decision: item.question } }
}

export function parseDecision(body, labels) {
  const answer = body?.answers?.decision
  const probs = answer?.probabilities
  if (typeof body?.model !== 'string' || !body.model.trim() || body.model.length > 256 ||
      answer?.type !== 'choice' || !labels.includes(answer.choice) ||
      !probs || typeof probs !== 'object' || Array.isArray(probs) ||
      Object.keys(probs).length !== labels.length ||
      !labels.every(label => Object.hasOwn(probs, label) && typeof probs[label] === 'number' &&
        Number.isFinite(probs[label]) && probs[label] >= 0 && probs[label] <= 1)) {
    throw new Error('Invalid decision response')
  }
  const values = labels.map(label => probs[label])
  if (Math.abs(values.reduce((a, b) => a + b, 0) - 1) > PROBABILITY_TOLERANCE ||
      probs[answer.choice] + 1e-9 < Math.max(...values)) throw new Error('Invalid decision distribution')
  return {
    model: body.model, choice: answer.choice,
    probabilities: Object.fromEntries(labels.map(label => [label, probs[label]])),
    selectedProbability: probs[answer.choice],
    // Jev, Laya and OpenJev do not necessarily mean the same thing by confidence.
    // Do not use a vendor confidence number as calibrated correctness.
  }
}

async function boundedJson(response) {
  if (!response.body) throw new Error('Missing response body')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = '', bytes = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Response too large')
      text += decoder.decode(value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text)
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function summarize(rows) {
  const valid = rows.filter(row => row.status === 'measured')
  const correct = valid.filter(row => row.correct).length
  const decided = valid.filter(row => row.choice !== 'need_more_evidence')
  const elapsed = rows.map(row => row.requestMs).sort((a, b) => a - b)
  const percentile = p => elapsed.length ? elapsed[Math.ceil(p * elapsed.length) - 1] : null
  return {
    attempts: rows.length, validResponses: valid.length, errors: rows.length - valid.length,
    correct, accuracyIncludingErrors: rows.length ? correct / rows.length : null,
    abstentions: valid.length - decided.length,
    decidedCoverage: rows.length ? decided.length / rows.length : null,
    accuracyWhenDecided: decided.length ? decided.filter(row => row.correct).length / decided.length : null,
    meanMulticlassBrier: valid.length ? valid.reduce((sum, row) => sum + row.brier, 0) / valid.length : null,
    requestP50Ms: percentile(0.5), requestP95Ms: percentile(0.95),
    firstRequestMs: rows[0]?.requestMs ?? null,
    latencyScope: 'Sequential client HTTP round trip, including errors. Excludes model download, ASR, screenshots, extraction and answer generation. First request is not necessarily a cold start.',
  }
}

export async function runBenchmark(cases, config, fetchImpl = fetch) {
  const url = endpointUrl(config.url)
  if (!Number.isInteger(config.repetitions) || config.repetitions < 1 || config.repetitions > 3 ||
      !Number.isInteger(config.timeoutMs) || config.timeoutMs < 50 || config.timeoutMs > 10000 ||
      !cases.length || cases.length > 50 || typeof config.token !== 'string' || /[\r\n]/.test(config.token)) {
    throw new Error('Invalid bounded benchmark configuration')
  }
  const labels = cases.map(validateCase)
  const requests = cases.map(item => requestFor(item, config.model))
  const rows = []
  for (let repetition = 0; repetition < config.repetitions; repetition++) {
    for (let index = 0; index < cases.length; index++) {
      const item = cases[index], started = performance.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), config.timeoutMs)
      let status = 'error', reason = 'network_or_protocol_error', decision = null
      try {
        const response = await fetchImpl(url, {
          method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
          headers: { 'Content-Type': 'application/json', ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}) },
          body: JSON.stringify(requests[index]),
        })
        if (!response.ok) {
          reason = `http_${response.status}`
          await response.body?.cancel().catch(() => {})
        } else {
          decision = parseDecision(await boundedJson(response), labels[index])
          if (controller.signal.aborted) throw new Error('Deadline exceeded')
          status = 'measured'
        }
      } catch {
        // Raw provider error bodies and supplied credentials never enter reports.
        reason = controller.signal.aborted ? 'timeout' : 'network_or_protocol_error'
      } finally { clearTimeout(timer) }
      const row = { id: item.id, category: item.category, repetition, expected: item.expected,
        requestMs: Math.round((performance.now() - started) * 100) / 100, status }
      if (status === 'measured') {
        const brier = labels[index].reduce((sum, label) => sum + (decision.probabilities[label] - Number(label === item.expected)) ** 2, 0)
        rows.push({ ...row, ...decision, correct: decision.choice === item.expected, brier })
      } else rows.push({ ...row, reason, correct: false })
    }
  }
  return {
    version: 1, status: 'measured', dataset: 'interview-decision-smoke-v1',
    note: EVIDENCE_NOTE, requestedModel: config.model,
    endpointOrigin: new URL(url).origin, createdAt: new Date().toISOString(),
    provenance: { hardware: config.hardware || 'not supplied', checkpoint: config.checkpoint || 'not supplied', quantization: config.quantization || 'not supplied', source: 'operator-supplied; not independently detected' },
    summary: summarize(rows),
    byCategory: Object.fromEntries([...new Set(rows.map(row => row.category))].map(category => [category, summarize(rows.filter(row => row.category === category))])),
    rows,
  }
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length > 1 || (args.length === 1 && !['--plan', '--live'].includes(args[0]))) throw new Error('Usage: node evals/decisions/benchmark.mjs [--plan|--live]')
  CASES.forEach(validateCase)
  if (!args.includes('--live')) {
    console.log(JSON.stringify({ status: 'not-run', cases: CASES.length, note: EVIDENCE_NOTE, ids: CASES.map(item => item.id), networkRequests: 0 }, null, 2))
    return
  }
  if (env.DECISION_BENCHMARK_APPROVED !== '1') throw new Error('Review the endpoint, data handling, model license and call cost; set DECISION_BENCHMARK_APPROVED=1 to opt in.')
  const config = {
    url: env.DECISION_BENCHMARK_URL || '', model: env.DECISION_BENCHMARK_MODEL || '',
    token: env.DECISION_BENCHMARK_TOKEN || '', repetitions: Number(env.DECISION_BENCHMARK_REPETITIONS || 1),
    timeoutMs: Number(env.DECISION_BENCHMARK_TIMEOUT_MS || 2500),
    hardware: env.DECISION_BENCHMARK_HARDWARE, checkpoint: env.DECISION_BENCHMARK_CHECKPOINT,
    quantization: env.DECISION_BENCHMARK_QUANTIZATION,
  }
  const report = await runBenchmark(CASES, config)
  const path = resolve(env.DECISION_BENCHMARK_REPORT || `benchmark-results/decisions-${Date.now()}.json`)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, JSON.stringify(report, null, 2), { flag: 'wx', mode: 0o600 })
  console.log(JSON.stringify({ report: path, summary: report.summary }, null, 2))
  // Smoke success is deliberately not a production quality approval.
  if (report.summary.errors || report.summary.correct !== report.summary.attempts) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('Decision benchmark failed. Check explicit configuration, endpoint availability, model identity and report path. No model quality result is established.'); process.exitCode = 2 })
}
