// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { collectBenchmark, configFromEnv, trialKey, trialSchedule, type BenchmarkConfig, type BenchmarkReport, type TrialCaller } from './benchmark'
import { repoBenchmarkFixtures } from './fixtures'
import { BENCHMARK_PURPOSES, benchmarkRequest, criteriaFor, digest } from './suite'
import { DEFAULT_GATES, reviewTemplate, selectModels, validateReport, type BenchmarkReviews } from './select'
import { repoModelFor } from '../../lib/repo/modelPolicy'
import { RepoModelResponseError } from '../../lib/repo/agentProviders'

const config = (): BenchmarkConfig => ({ models: ['claude-sonnet-5', 'gpt-5.6-sol'], purposes: [...BENCHMARK_PURPOSES], caseIds: repoBenchmarkFixtures.slice(0, 3).map((item) => item.id), repetitions: 2, seed: 'unit-test', maxCalls: 200 })
const fakeCaller: TrialCaller = async (trial) => ({ model: trial.model, text: `Synthetic unit-test response for ${trial.caseId}`, usage: { inputTokens: 300, outputTokens: 150 } })

// Synthetic reports stay in test memory. Marking live here exercises the parser;
// these fake answers are never written, published, or claimed as measurements.
async function exampleReport(overrides: Partial<BenchmarkConfig> = {}, caller = fakeCaller): Promise<BenchmarkReport> {
  const report = await collectBenchmark({ mode: 'mock', config: { ...config(), ...overrides }, caller })
  report.mode = 'live'
  report.rows.forEach((row) => { row.latencyMs = row.requestedModel === 'claude-sonnet-5' ? 300 : 100 })
  return report
}
function reviewed(report: BenchmarkReport): BenchmarkReviews {
  const reviews = reviewTemplate(report)
  reviews.reviewer = 'unit-test-only'; reviews.reviewedAt = new Date().toISOString()
  reviews.rows.forEach((row) => Object.values(row.checks).forEach((check) => { check.outcome = 'pass'; check.note = 'Synthetic assertion for unit-test coverage only.' }))
  return reviews
}

describe('reproducible repository benchmark collection', () => {
  it('creates six distinct source cases with purpose-specific answer keys', () => {
    expect(new Set(repoBenchmarkFixtures.map((item) => item.id)).size).toBe(6)
    for (const fixture of repoBenchmarkFixtures) for (const purpose of BENCHMARK_PURPOSES) {
      const criteria = criteriaFor(fixture, purpose)
      expect(criteria.length).toBeGreaterThanOrEqual(5)
      expect(new Set(criteria.map((item) => item.id)).size).toBe(criteria.length)
    }
  })
  it('records fixed synthesis opinions alongside original source, including failed and incorrect specialists', () => {
    const fixture = repoBenchmarkFixtures[0]
    const request = benchmarkRequest(fixture, 'synthesis')
    const evidence = JSON.parse(request.evidence)
    expect(evidence.sourceEvidence.repositoryEvidence).toBe(fixture.input.context)
    expect(evidence.specialistReports).toContainEqual(expect.objectContaining({ role: 'reviewer', status: 'failed' }))
    expect(evidence.specialistReports[1].text).toContain('guarantees one event even when two requests cancel concurrently')
    expect(request.system).toContain('Never treat consensus as proof')
  })
  it('uses deterministic interleaved trials and enforces the explicit call cap', () => {
    const cfg = config()
    const trials = trialSchedule(cfg)
    expect(trials).toEqual(trialSchedule(cfg))
    expect(new Set(trials.map(trialKey)).size).toBe(72)
    expect(trials[0].model).not.toBe(trials[1].model)
    expect(trialSchedule({ ...cfg, seed: 'another-seed' })).not.toEqual(trials)
    expect(() => trialSchedule({ ...cfg, maxCalls: 10 })).toThrow('exceeding')
    expect(() => trialSchedule({ ...cfg, caseIds: [cfg.caseIds[0], cfg.caseIds[0]] })).toThrow('duplicate')
  })
  it('expands requirements into question and navigation purposes and validates explicit IDs', () => {
    const parsed = configFromEnv({ REPO_BENCHMARK_MODELS: 'claude-sonnet-5', REPO_BENCHMARK_ROLES: 'requirements' })
    expect(parsed.purposes).toEqual(['requirements', 'navigation'])
    expect(parsed.repetitions).toBe(2)
    expect(() => configFromEnv({ REPO_BENCHMARK_MODELS: 'https://bad?key=secret' })).toThrow('IDs')
    expect(() => configFromEnv({ REPO_BENCHMARK_MODELS: 'claude-sonnet-5', REPO_BENCHMARK_PURPOSES: 'vision' })).toThrow('purposes')
  })
  it('keeps partial checkpoints and provider errors without exposing provider messages', async () => {
    const checkpoints: number[] = []
    const report = await collectBenchmark({ mode: 'mock', config: { ...config(), models: ['claude-sonnet-5'], purposes: ['debugger'], caseIds: [repoBenchmarkFixtures[0].id], repetitions: 1 },
      caller: async () => { throw new Error('provider rejected secret api-key-12345') }, checkpoint: async (snapshot) => { checkpoints.push(snapshot.rows.length) } })
    expect(checkpoints).toEqual([0, 1, 1])
    expect(report.rows[0]).toMatchObject({ status: 'error', error: 'provider-configuration' })
    expect(JSON.stringify(report)).not.toContain('12345')
    expect(report.completedAt).toBeTruthy()
    await expect(collectBenchmark({ mode: 'mock', config: config() })).rejects.toThrow('explicit fake caller')
  })
  it('preserves requested versus actual model identity, usage and production generation settings', async () => {
    const report = await collectBenchmark({ mode: 'mock', config: { ...config(), models: ['claude-sonnet-5'], purposes: ['debugger'] }, caller: async (trial, req) => ({ ...await fakeCaller(trial, req), model: 'claude-sonnet-5-unit-snapshot' }) })
    expect(report.rows[0]).toMatchObject({ requestedModel: 'claude-sonnet-5', actualModel: 'claude-sonnet-5-unit-snapshot', usage: { inputTokens: 300, outputTokens: 150 } })
    expect(report.generationSettings[0]).toMatchObject({ model: 'claude-sonnet-5', specialist: { maxTokens: 2200 }, synthesis: { maxTokens: 4500 } })
    expect(report.rows[0].responseSha256).toBe(digest(report.rows[0].response))
  })
})

describe('reviewed model selection', () => {
  it('requires completed live reports and complete evidence, never a mock score', async () => {
    const report = await exampleReport()
    report.mode = 'mock'
    expect(() => reviewTemplate(report)).toThrow('completed live')
    report.mode = 'live'; report.completedAt = undefined
    expect(() => reviewTemplate(report)).toThrow('completed live')
    const full = await exampleReport()
    full.rows.pop()
    expect(() => reviewTemplate(full)).toThrow('coverage')
  })
  it('requires a concrete human judgment for every criterion and every completed response', async () => {
    const report = await exampleReport()
    const reviews = reviewTemplate(report)
    expect(() => selectModels(report, reviews)).toThrow('Reviewer identity')
    reviews.reviewer = 'unit-test-only'; reviews.reviewedAt = new Date().toISOString()
    expect(() => selectModels(report, reviews)).toThrow('Unreviewed criterion')
    const partial = reviewed(report); partial.rows.pop()
    expect(() => selectModels(report, partial)).toThrow('every completed response')
    const duplicated = reviewed(report); duplicated.rows.push(duplicated.rows[0])
    expect(() => selectModels(report, duplicated)).toThrow('Duplicate')
  })
  it('uses reviewed correctness before speed, and never keyword/path proxy scores', async () => {
    const report = await exampleReport()
    report.rows.forEach((row) => { if (row.diagnostics) row.diagnostics.proxyScore = row.requestedModel.startsWith('gpt') ? 1 : 0 })
    const reviews = reviewed(report)
    const wrong = report.rows.find((row) => row.purpose === 'debugger' && row.requestedModel.startsWith('gpt'))!
    reviews.rows.find((row) => row.rowId === wrong.id)!.checks['root-cause'] = { outcome: 'fail', note: 'Test: root cause was incorrect despite perfect keyword coverage.' }
    const result = selectModels(report, reviews)
    expect(result.policy.roles.debugger?.model).toBe('claude-sonnet-5')
    expect(result.policy.roles.reviewer?.model).toBe('gpt-5.6-sol')
    expect(result.summaries.find((row) => row.purpose === 'debugger' && row.requestedModel.startsWith('gpt'))?.reasons).toContain('correctness-below-gate')
    expect(repoModelFor('debugger', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(result.policy) })).toMatchObject({ source: 'measured', model: 'claude-sonnet-5' })
  })
  it('requires distinct cases and repetitions independently', async () => {
    const oneCase = await exampleReport({ caseIds: [repoBenchmarkFixtures[0].id], repetitions: 6 })
    expect(selectModels(oneCase, reviewed(oneCase)).policy.roles).toEqual({})
    const oneRepeat = await exampleReport({ repetitions: 1 })
    expect(selectModels(oneRepeat, reviewed(oneRepeat)).policy.roles).toEqual({})
  })
  it('qualifies requirements only when both question capture and navigation were reviewed', async () => {
    const report = await exampleReport({ purposes: ['requirements'] })
    expect(selectModels(report, reviewed(report)).policy.roles.requirements).toBeUndefined()
    const full = await exampleReport({ purposes: ['requirements', 'navigation'] })
    expect(selectModels(full, reviewed(full)).policy.roles.requirements?.measurements.map((row) => row.purpose)).toEqual(['requirements', 'navigation'])
  })
  it('counts provider failures in both correctness and reliability, keeping a healthy candidate eligible', async () => {
    const report = await exampleReport({}, async (trial, req) => {
      if (trial.model.startsWith('gpt') && trial.purpose === 'reviewer') throw new Error('timeout')
      return fakeCaller(trial, req)
    })
    const result = selectModels(report, reviewed(report))
    expect(result.policy.roles.reviewer?.model).toBe('claude-sonnet-5')
    expect(result.summaries.find((row) => row.requestedModel.startsWith('gpt') && row.purpose === 'reviewer')).toMatchObject({ errorRate: 1, passRate: 0, eligible: false })
  })
  it('retains billed usage from incomplete responses and exposes unknown failure cost', async () => {
    const report = await exampleReport({ purposes: ['debugger'] }, async (trial, req) => {
      if (trial.model.startsWith('gpt')) throw new RepoModelResponseError('Answer reached its output limit', trial.model, { inputTokens: 300, outputTokens: 8000 })
      return fakeCaller(trial, req)
    })
    expect(report.rows.find((row) => row.status === 'error')).toMatchObject({ actualModel: 'gpt-5.6-sol', usage: { inputTokens: 300, outputTokens: 8000 } })
    const result = selectModels(report, reviewed(report))
    expect(result.summaries.find((row) => row.requestedModel.startsWith('gpt'))).toMatchObject({ usageCoverage: 1, meanOutputTokens: 8000, observedOutputTokens: 48_000 })
    delete report.rows.find((row) => row.status === 'error')!.usage
    const missing = selectModels(report, reviewed(report)).summaries.find((row) => row.requestedModel.startsWith('gpt'))!
    expect(missing.usageCoverage).toBeLessThan(1)
    expect(missing.meanOutputTokens).toBeNull()
  })
  it('rejects edited answers, prompt drift and response reviews from an older report', async () => {
    const report = await exampleReport(); const reviews = reviewed(report)
    report.rows[0].response += ' modified'
    expect(() => selectModels(report, reviews)).toThrow('modified')
    const promptDrift = await exampleReport(); promptDrift.rows[0].systemSha256 = '0'.repeat(64)
    expect(() => validateReport(promptDrift)).toThrow('prompt/evidence')
    const newReport = await exampleReport()
    expect(() => selectModels(newReport, reviews)).toThrow('exact completed report')
  })
  it('rejects duplicate trial coverage even when total row count matches', async () => {
    const report = await exampleReport()
    report.rows[1] = { ...report.rows[0] }
    expect(() => validateReport(report)).toThrow('Duplicate')
  })
  it('pins the returned model ID and disqualifies aliases that drift across trials', async () => {
    const report = await exampleReport({}, async (trial, req) => ({ ...await fakeCaller(trial, req), model: `${trial.model}-unit-snapshot-${trial.model.startsWith('gpt') ? trial.repetition : 1}` }))
    const result = selectModels(report, reviewed(report))
    expect(result.policy.roles.debugger?.model).toBe('claude-sonnet-5-unit-snapshot-1')
    expect(result.summaries.find((row) => row.requestedModel.startsWith('gpt'))?.reasons).toContain('missing-or-changing-actual-model')
  })
  it('enforces latency/quality gates and records missing token measurements honestly', async () => {
    const report = await exampleReport()
    report.rows.forEach((row) => { row.latencyMs = 51_000; delete row.usage })
    const reviews = reviewed(report)
    const result = selectModels(report, reviews)
    expect(result.policy.roles).toEqual({})
    expect(result.summaries[0].meanInputTokens).toBeNull()
    expect(() => selectModels(report, reviews, { ...DEFAULT_GATES, minPassRate: 0.5 })).toThrow('Quality gates')
    expect(() => selectModels(report, reviews, { ...DEFAULT_GATES, minRepetitions: 1 })).toThrow('Quality gates')
  })
  it('does not send measured source or answers to an external judge', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network'))
    try {
      const report = await exampleReport()
      expect(Object.keys(selectModels(report, reviewed(report)).policy.roles)).toHaveLength(5)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally { fetchSpy.mockRestore() }
  })
})
