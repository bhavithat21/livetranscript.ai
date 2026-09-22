import { describe, expect, it } from 'vitest'
import { classifierFixtures } from './fixtures'
import { classifierRunConfiguration, classifierSummary, proposeClassifier, summarizeClassifierRows, type ClassifierRow } from './report'

function row(overrides: Partial<ClassifierRow> = {}): ClassifierRow {
  const fixture = classifierFixtures[0]
  return {
    variant: 'jev', repetition: 1, fixture: fixture.id, category: fixture.category, expected: fixture.expected,
    path: 'network', elapsedMs: 100, result: { ...fixture.expected, confidence: 0.95 },
    attempts: [{ provider: 'jev', model: 'jev-snapshot', requestedModel: 'jev-latest', returnedModel: 'jev-snapshot', elapsedMs: 100, outcome: 'accepted' }],
    ...overrides,
  }
}

function completedComparison(repetitions = 3): ClassifierRow[] {
  const rows: ClassifierRow[] = []
  for (let repetition = 1; repetition <= repetitions; repetition++) for (const fixture of classifierFixtures) for (const variant of ['legacy', 'jev'] as const) {
    const model = variant === 'jev' ? 'jev-snapshot' : 'legacy-snapshot'
    rows.push(row({
      variant, repetition, fixture: fixture.id, category: fixture.category, expected: fixture.expected,
      result: { ...fixture.expected, confidence: 0.95 }, elapsedMs: variant === 'jev' ? 100 : 200,
      attempts: [{ provider: variant === 'jev' ? 'jev' : 'openai', model, requestedModel: model, returnedModel: model, elapsedMs: variant === 'jev' ? 100 : 200, outcome: 'accepted' }],
    }))
  }
  return rows
}

describe('classifier benchmark validity', () => {
  it('counts a null as an error and a missed question/web fact instead of omitting it', () => {
    const expected = { mode: 'coding' as const, isQuestion: true, needsWeb: true }
    const summary = summarizeClassifierRows([row({ expected, result: null }), row({ expected, result: { ...expected, confidence: 0.95 } })])
    expect(summary.exactAccuracy).toBe(0.5)
    expect(summary.nullRate).toBe(0.5)
    expect(summary.questionFalseNegativeRate).toBe(0.5)
    expect(summary.webFalseNegativeRate).toBe(0.5)
  })

  it('counts actual fallback requests and keeps missing usage unknown', () => {
    const measured = row({ attempts: [
      { provider: 'jev', model: 'jev-snapshot', requestedModel: 'jev-latest', returnedModel: 'jev-snapshot', elapsedMs: 30, outcome: 'uncertain', usage: { inputTokens: 10, outputTokens: 5 } },
      { provider: 'openai', model: 'gpt-snapshot', requestedModel: 'gpt-snapshot', returnedModel: 'gpt-snapshot', elapsedMs: 70, outcome: 'accepted' },
    ] })
    const summary = summarizeClassifierRows([measured])
    expect(summary.fallbackCount).toBe(1)
    expect(summary.fallbackRateAmongNetwork).toBe(1)
    expect(summary.providerRequests).toBe(2)
    expect(summary.tokens).toEqual({ requestsWithUsage: 1, requestsWithoutUsage: 1, reportedInputSubtotal: 10, reportedOutputSubtotal: 5 })
  })

  it('keeps network latency visible when most utterances route locally', () => {
    const rows = [...Array.from({ length: 30 }, () => row({ path: 'local', elapsedMs: 0.01, attempts: [] })), row({ elapsedMs: 900 })]
    const summary = classifierSummary(rows).jev
    expect(summary.allUtterances.latencyMs.p95).toBe(0.01)
    expect(summary.networkAmbiguous.latencyMs.p95).toBe(900)
    expect(summary.networkAmbiguous.samples).toBe(1)
  })

  it('reports absent denominators as unknown, not perfect accuracy', () => {
    const summary = summarizeClassifierRows([])
    expect(summary.exactAccuracy).toBeNull()
    expect(summary.questionFalseNegativeRate).toBeNull()
    expect(summary.latencyMs.p95).toBeNull()
  })

  it('only proposes review after a real complete, accurate and faster comparison', () => {
    expect(proposeClassifier(completedComparison(), 3, true)).toMatchObject({ candidate: 'jev', reviewed: false, productionChanged: false, status: 'eligible-for-human-review' })
  })

  it('rejects a fast candidate that silently drops even one additional question', () => {
    const rows = completedComparison()
    const measured = rows.find((item) => item.variant === 'jev')!
    measured.result = { ...measured.result!, isQuestion: false }
    const proposal = proposeClassifier(rows, 3, true)
    expect(proposal.candidate).toBeNull()
    expect(proposal.reasons.some((reason) => reason.includes('missed questions'))).toBe(true)
  })

  it('rejects fast provider failures even when other local decisions are accurate', () => {
    const rows = completedComparison()
    for (const measured of rows.filter((item) => item.variant === 'jev')) {
      measured.elapsedMs = 1
      measured.result = null
      measured.attempts[0].outcome = 'error'
      measured.attempts[0].returnedModel = null
    }
    expect(proposeClassifier(rows, 3, true).candidate).toBeNull()
  })

  it('rejects accurate fallback pipelines when total network p95 becomes slower', () => {
    const rows = completedComparison()
    for (const measured of rows.filter((item) => item.variant === 'jev')) measured.elapsedMs = 350
    const proposal = proposeClassifier(rows, 3, true)
    expect(proposal.candidate).toBeNull()
    expect(proposal.reasons.some((reason) => reason.includes('including fallback'))).toBe(true)
  })

  it('rejects incomplete suites, duplicate fixture rows and insufficient repetitions', () => {
    const rows = completedComparison()
    expect(proposeClassifier(rows, 3, false).candidate).toBeNull()
    rows[0] = { ...rows[2] }
    expect(proposeClassifier(rows, 3, true).candidate).toBeNull()
    expect(proposeClassifier(completedComparison(1), 1, true).candidate).toBeNull()
  })

  it('rejects an alias that changes returned identity during measurement', () => {
    const rows = completedComparison()
    rows.find((item) => item.variant === 'jev')!.attempts[0].returnedModel = 'jev-different-snapshot'
    expect(proposeClassifier(rows, 3, true).reasons.some((reason) => reason.includes('identity changed'))).toBe(true)
  })

  it('requires both providers before making a paid comparison', () => {
    const configuration = classifierRunConfiguration({ TYPESAFE_API_KEY: 'configured' })
    expect(configuration.errors).toEqual(['OPENAI_API_KEY is required for a valid comparison; no provider requests were made'])
    expect(classifierRunConfiguration({ OPENAI_API_KEY: 'configured', TYPESAFE_API_KEY: 'configured' }).errors).toEqual([])
    expect(classifierRunConfiguration({ GROQ_API_KEY: 'configured', TYPESAFE_API_KEY: 'configured' }).requestedModels.legacy).toBe('llama-3.3-70b-versatile')
  })

  it('rejects unbounded repetitions and unsupported legacy model providers', () => {
    for (const repetitions of ['0', '6', '1.5', 'NaN']) {
      expect(classifierRunConfiguration({ CLASSIFIER_BENCHMARK_REPEATS: repetitions }).errors[0]).toContain('integer from 1 through 5')
    }
    expect(classifierRunConfiguration({ COPILOT_CLASSIFIER_MODEL: 'claude-sonnet-5' }).errors).toContain('The production legacy classifier supports OpenAI or Groq models only')
  })
})
