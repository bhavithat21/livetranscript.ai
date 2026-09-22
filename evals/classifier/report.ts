import { createHash } from 'node:crypto'
import type { Classification } from '../../lib/copilot/classification'
import { vendorForModel } from '../../lib/copilot/modes'
import type { ClassifierAttempt } from '../../lib/copilot/serverClassifier'
import { classifierFixtures, type ClassifierFixture, type ExpectedClassification } from './fixtures'

export const CLASSIFIER_VARIANTS = ['legacy', 'jev'] as const
export type ClassifierVariant = typeof CLASSIFIER_VARIANTS[number]
export type MeasuredAttempt = ClassifierAttempt & { requestedModel: string; returnedModel: string | null }
export type ClassifierRow = {
  variant: ClassifierVariant
  repetition: number
  fixture: string
  category: ClassifierFixture['category']
  expected: ExpectedClassification
  path: 'local' | 'network'
  elapsedMs: number
  result: Classification | null
  attempts: MeasuredAttempt[]
  error?: string
}

const rate = (numerator: number, denominator: number): number | null => denominator ? numerator / denominator : null

export function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

export function exactlyCorrect(row: ClassifierRow): boolean {
  return row.result !== null && row.result.mode === row.expected.mode
    && row.result.isQuestion === row.expected.isQuestion && row.result.needsWeb === row.expected.needsWeb
}

export function summarizeClassifierRows(rows: ClassifierRow[]) {
  const questions = rows.filter((row) => row.expected.isQuestion)
  const chatter = rows.filter((row) => !row.expected.isQuestion)
  const web = rows.filter((row) => row.expected.needsWeb)
  const network = rows.filter((row) => row.path === 'network')
  const correct = rows.filter(exactlyCorrect)
  const nullCount = rows.filter((row) => row.result === null).length
  const questionFalseNegatives = questions.filter((row) => row.result?.isQuestion !== true).length
  const webFalseNegatives = web.filter((row) => row.result?.needsWeb !== true).length
  const chatterFalsePositives = chatter.filter((row) => row.result?.isQuestion === true).length
  const fallbackCount = network.filter((row) => row.variant === 'jev' && row.attempts.some((attempt) => attempt.provider !== 'jev')).length
  const attempts = rows.flatMap((row) => row.attempts)
  const knownUsage = attempts.filter((attempt) => attempt.usage)
  return {
    samples: rows.length,
    localSamples: rows.length - network.length,
    networkSamples: network.length,
    correct: correct.length,
    exactAccuracy: rate(correct.length, rows.length),
    modeAccuracy: rate(rows.filter((row) => row.result?.mode === row.expected.mode).length, rows.length),
    questionAccuracy: rate(rows.filter((row) => row.result?.isQuestion === row.expected.isQuestion).length, rows.length),
    needsWebAccuracy: rate(rows.filter((row) => row.result?.needsWeb === row.expected.needsWeb).length, rows.length),
    nullCount, nullRate: rate(nullCount, rows.length),
    expectedQuestions: questions.length, questionFalseNegatives,
    questionFalseNegativeRate: rate(questionFalseNegatives, questions.length),
    expectedWeb: web.length, webFalseNegatives, webFalseNegativeRate: rate(webFalseNegatives, web.length),
    expectedChatter: chatter.length, chatterFalsePositives, chatterFalsePositiveRate: rate(chatterFalsePositives, chatter.length),
    fallbackCount, fallbackRateAmongNetwork: rate(fallbackCount, network.length),
    latencyMs: { p50: percentile(rows.map((row) => row.elapsedMs), 0.5), p95: percentile(rows.map((row) => row.elapsedMs), 0.95) },
    correctOnlyLatencyMs: { p50: percentile(correct.map((row) => row.elapsedMs), 0.5), p95: percentile(correct.map((row) => row.elapsedMs), 0.95) },
    providerRequests: attempts.length,
    providerErrors: attempts.filter((attempt) => attempt.outcome === 'error').length,
    uncertainAttempts: attempts.filter((attempt) => attempt.outcome === 'uncertain').length,
    unconfiguredAttempts: attempts.filter((attempt) => attempt.outcome === 'unconfigured').length,
    tokens: {
      requestsWithUsage: knownUsage.length, requestsWithoutUsage: attempts.length - knownUsage.length,
      reportedInputSubtotal: knownUsage.reduce((sum, attempt) => sum + attempt.usage!.inputTokens, 0),
      reportedOutputSubtotal: knownUsage.reduce((sum, attempt) => sum + attempt.usage!.outputTokens, 0),
    },
  }
}

export function classifierSummary(rows: ClassifierRow[]) {
  return Object.fromEntries(CLASSIFIER_VARIANTS.map((variant) => {
    const variantRows = rows.filter((row) => row.variant === variant)
    return [variant, {
      allUtterances: summarizeClassifierRows(variantRows),
      questionPath: summarizeClassifierRows(variantRows.filter((row) => row.expected.isQuestion)),
      networkAmbiguous: summarizeClassifierRows(variantRows.filter((row) => row.path === 'network')),
      networkQuestions: summarizeClassifierRows(variantRows.filter((row) => row.path === 'network' && row.expected.isQuestion)),
      byCategory: Object.fromEntries([...new Set(classifierFixtures.map((fixture) => fixture.category))]
        .map((category) => [category, summarizeClassifierRows(variantRows.filter((row) => row.category === category))])),
    }]
  }))
}

export function classifierRunConfiguration(env: Record<string, string | undefined> = process.env) {
  const repetitions = Number(env.CLASSIFIER_BENCHMARK_REPEATS ?? '3')
  const legacyModel = env.COPILOT_CLASSIFIER_MODEL || (env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini')
  const jevModel = env.TYPESAFE_MODEL || 'jev-latest'
  const errors: string[] = []
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 5) errors.push('CLASSIFIER_BENCHMARK_REPEATS must be an integer from 1 through 5')
  if (![legacyModel, jevModel].every((model) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(model))) errors.push('Model IDs must be nonempty identifiers of at most 160 characters')
  const vendor = vendorForModel(legacyModel)
  if (vendor !== 'openai' && vendor !== 'groq') errors.push('The production legacy classifier supports OpenAI or Groq models only')
  const legacyKey = vendor === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY'
  const requiredEnvironment = ['TYPESAFE_API_KEY', legacyKey]
  for (const key of requiredEnvironment) if (!env[key]?.trim()) errors.push(`${key} is required for a valid comparison; no provider requests were made`)
  return { repetitions, requestedModels: { legacy: legacyModel, jev: jevModel }, requiredEnvironment, errors }
}

export function classifierSuiteSha256(): string {
  return createHash('sha256').update(JSON.stringify(classifierFixtures)).digest('hex')
}

// These conservative gates are an initial review rubric, not statistical proof.
// No environment variable or production policy is written by this benchmark.
export function proposeClassifier(rows: ClassifierRow[], repetitions: number, complete: boolean) {
  const reasons: string[] = []
  const baselineRows = rows.filter((row) => row.variant === 'legacy')
  const candidateRows = rows.filter((row) => row.variant === 'jev')
  const baseline = summarizeClassifierRows(baselineRows)
  const candidate = summarizeClassifierRows(candidateRows)
  const networkBaseline = summarizeClassifierRows(baselineRows.filter((row) => row.path === 'network'))
  const networkCandidate = summarizeClassifierRows(candidateRows.filter((row) => row.path === 'network'))
  const matchesSuite = (variantRows: ClassifierRow[]) => variantRows.length === classifierFixtures.length * repetitions
    && classifierFixtures.every((fixture) => Array.from({ length: repetitions }, (_, index) => index + 1)
      .every((repetition) => variantRows.filter((row) => row.fixture === fixture.id && row.repetition === repetition).length === 1))
  if (!complete || !matchesSuite(baselineRows) || !matchesSuite(candidateRows)) reasons.push('Both variants must complete the same full fixture suite')
  if (!Number.isInteger(repetitions) || repetitions < 3) reasons.push('At least three repetitions are required before proposing a change')
  if (!networkBaseline.samples || networkBaseline.samples !== networkCandidate.samples) reasons.push('Comparable measured network samples are required')
  if (!candidateRows.some((row) => row.attempts.some((attempt) => attempt.provider === 'jev' && attempt.outcome === 'accepted' && attempt.returnedModel))) reasons.push('Jev must return at least one accepted decision with a model identity')
  if (!baselineRows.some((row) => row.attempts.some((attempt) => attempt.provider !== 'jev' && attempt.outcome === 'accepted' && attempt.returnedModel))) reasons.push('The legacy provider must return accepted decisions with a model identity')
  if ((candidate.exactAccuracy ?? 0) < 0.9 || (networkCandidate.exactAccuracy ?? 0) < 0.9) reasons.push('Jev pipeline must reach 90% exact accuracy overall and on network cases')
  if ((candidate.exactAccuracy ?? 0) < (baseline.exactAccuracy ?? 0)
    || (networkCandidate.exactAccuracy ?? 0) < (networkBaseline.exactAccuracy ?? 0)) reasons.push('Jev pipeline must not reduce exact accuracy')
  if (candidate.questionFalseNegatives > baseline.questionFalseNegatives || candidate.webFalseNegatives > baseline.webFalseNegatives
    || candidate.chatterFalsePositives > baseline.chatterFalsePositives || candidate.nullCount > baseline.nullCount) reasons.push('Jev pipeline must not increase missed questions, missed web facts, chatter activations or null results')
  for (const provider of ['jev', 'openai', 'groq'] as const) {
    const identities = new Set(rows.flatMap((row) => row.attempts).filter((attempt) => attempt.provider === provider && attempt.returnedModel).map((attempt) => attempt.returnedModel))
    if (identities.size > 1) reasons.push(`Returned ${provider} model identity changed during the run; pin a stable candidate and rerun`)
  }
  if (networkCandidate.latencyMs.p95 === null || networkBaseline.latencyMs.p95 === null
    || networkCandidate.latencyMs.p95 >= networkBaseline.latencyMs.p95) reasons.push('Jev pipeline must reduce measured network p95 classification latency, including fallback')
  return {
    candidate: reasons.length ? null : 'jev', reviewed: false, productionChanged: false,
    status: reasons.length ? 'no-change-proposed' : 'eligible-for-human-review', reasons,
    note: 'A passing result proposes review only. Inspect raw decisions, confidence/fallback patterns and errors; repeat on representative held-out utterances before changing production. This suite is not a general model ranking.',
  }
}
