import { randomUUID } from 'node:crypto'
import { callRepoModel, RepoModelResponseError, repoGenerationSettings, streamRepoModel } from '../../lib/repo/agentProviders'
import { validRepoModel } from '../../lib/repo/modelPolicy'
import { repoBenchmarkFixtures, scoreRepoBenchmark, type RepoBenchmarkScore } from './fixtures'
import { BENCHMARK_PURPOSES, benchmarkRequest, digest, roleForPurpose, suiteManifest, type BenchmarkPurpose } from './suite'

export type BenchmarkConfig = { models: string[]; purposes: BenchmarkPurpose[]; caseIds: string[]; repetitions: number; seed: string; maxCalls: number }
export type BenchmarkRow = {
  id: string; requestedModel: string; actualModel?: string; purpose: BenchmarkPurpose; caseId: string; repetition: number
  status: 'completed' | 'error'; latencyMs: number; timeToFirstTokenMs?: number; usage?: { inputTokens: number; outputTokens: number }
  response?: string; responseSha256?: string; diagnostics?: RepoBenchmarkScore; error?: string
  systemSha256: string; evidenceSha256: string
}
export type BenchmarkReport = {
  version: 2; benchmarkId: string; mode: 'live' | 'mock'; startedAt: string; completedAt?: string; gitCommit: string | null
  suite: ReturnType<typeof suiteManifest>; config: BenchmarkConfig; expectedCalls: number; rows: BenchmarkRow[]; limitations: string[]
  generationSettings: { model: string; specialist: ReturnType<typeof repoGenerationSettings>; synthesis: ReturnType<typeof repoGenerationSettings> }[]
}

const LIMITATIONS = [
  'Synthetic source scenarios measure isolated calls, not end-to-end interview or transcript latency.',
  'No image OCR, hidden-repository reconstruction or generated-code execution is performed in this suite.',
  'Keyword diagnostics never determine correctness or model selection; each completed answer needs criterion-by-criterion human review.',
  'Fixed synthesis notes include an incorrect opinion and a failed reviewer; they are not outputs of live specialist calls.',
  'No hosted coding-leaderboard score is treated as measured product quality. Account availability, prices and deployed latency can differ.',
  'Six cases with repeated trials are a local regression gate, not statistically conclusive superiority on arbitrary repositories.',
]

export function configFromEnv(env: Record<string, string | undefined>): BenchmarkConfig {
  const models = (env.REPO_BENCHMARK_MODELS ?? '').split(',').map((item) => item.trim()).filter(Boolean)
  const roleNames = env.REPO_BENCHMARK_ROLES?.split(',').map((item) => item.trim()).filter(Boolean)
  const purposes = (env.REPO_BENCHMARK_PURPOSES?.split(',').map((item) => item.trim()).filter(Boolean)
    ?? (roleNames ? roleNames.flatMap((role) => role === 'requirements' ? ['requirements', 'navigation'] : [role]) : [...BENCHMARK_PURPOSES])) as BenchmarkPurpose[]
  const caseIds = env.REPO_BENCHMARK_CASES?.split(',').map((item) => item.trim()).filter(Boolean) ?? repoBenchmarkFixtures.map((item) => item.id)
  const config = { models, purposes, caseIds, repetitions: Number(env.REPO_BENCHMARK_REPETITIONS ?? 2), seed: env.REPO_BENCHMARK_SEED ?? 'repo-purpose-v2', maxCalls: Number(env.REPO_BENCHMARK_MAX_CALLS ?? 200) }
  validateConfig(config)
  return config
}

export function validateConfig(config: BenchmarkConfig): void {
  if (!config.models.length || !config.models.every(validRepoModel) || new Set(config.models).size !== config.models.length) throw new Error('Set unique account-supported REPO_BENCHMARK_MODELS IDs')
  if (!config.purposes.length || !config.purposes.every((purpose) => BENCHMARK_PURPOSES.includes(purpose)) || new Set(config.purposes).size !== config.purposes.length) throw new Error('Invalid or duplicate benchmark purposes')
  if (!config.caseIds.length || !config.caseIds.every((id) => repoBenchmarkFixtures.some((fixture) => fixture.id === id)) || new Set(config.caseIds).size !== config.caseIds.length) throw new Error('Invalid or duplicate benchmark cases')
  if (!Number.isInteger(config.repetitions) || config.repetitions < 1 || config.repetitions > 10) throw new Error('Benchmark repetitions must be between 1 and 10')
  if (typeof config.seed !== 'string' || !config.seed || config.seed.length > 200) throw new Error('Invalid benchmark seed')
  if (!Number.isInteger(config.maxCalls) || config.maxCalls < 1 || config.maxCalls > 2000) throw new Error('Benchmark max calls must be between 1 and 2000')
  const count = config.models.length * config.purposes.length * config.caseIds.length * config.repetitions
  if (count > config.maxCalls) throw new Error(`This run would make ${count} calls, exceeding REPO_BENCHMARK_MAX_CALLS=${config.maxCalls}. Narrow candidates/purposes or explicitly raise the cap.`)
}

export type Trial = { model: string; purpose: BenchmarkPurpose; caseId: string; repetition: number }
export function trialKey(trial: Trial): string { return JSON.stringify([trial.model, trial.purpose, trial.caseId, trial.repetition]) }
export function trialSchedule(config: BenchmarkConfig): Trial[] {
  validateConfig(config)
  const trials: Trial[] = []
  for (let repetition = 1; repetition <= config.repetitions; repetition++) {
    const cases = config.purposes.flatMap((purpose) => config.caseIds.map((caseId) => ({ purpose, caseId })))
      .sort((a, b) => digest([config.seed, repetition, a]).localeCompare(digest([config.seed, repetition, b])))
    cases.forEach(({ purpose, caseId }, index) => {
      // Rotate candidate order across scenarios/repeats rather than running all
      // of one provider first. Sequential calls also limit provider contention.
      config.models.forEach((_, offset) => trials.push({ model: config.models[(index + repetition - 1 + offset) % config.models.length], purpose, caseId, repetition }))
    })
  }
  return trials
}

export type TrialResult = { text: string; model: string; timeToFirstTokenMs?: number; usage?: { inputTokens: number; outputTokens: number } }
export type TrialCaller = (trial: Trial, request: { system: string; evidence: string }) => Promise<TrialResult>
export const callProductionTrial: TrialCaller = async (trial, request) => {
  if (roleForPurpose(trial.purpose) !== 'synthesis') return callRepoModel({ model: trial.model, ...request, signal: AbortSignal.timeout(35_000) })
  const start = performance.now()
  let text = ''; let model = ''; let timeToFirstTokenMs: number | undefined; let usage: TrialResult['usage']
  for await (const delta of streamRepoModel({ model: trial.model, ...request, signal: AbortSignal.timeout(55_000), onUsage: (value) => { usage = value } })) {
    if (model && model !== delta.model) throw new Error('Provider model identity changed during the stream')
    model = delta.model
    if (delta.text && timeToFirstTokenMs === undefined) timeToFirstTokenMs = Math.round(performance.now() - start)
    text += delta.text
  }
  if (!text.trim()) throw new Error('Model returned no analysis')
  return { text, model, timeToFirstTokenMs, usage }
}

function errorCategory(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  if (/timeout|timed out|abort/i.test(message)) return 'timeout-or-cancelled'
  if (/required|configuration|api.?key/i.test(message)) return 'provider-configuration'
  if (/limit|complete|no analysis|identity/i.test(message)) return 'incomplete-response'
  return 'provider-error' // No provider error bodies or credentials enter reports.
}

export async function collectBenchmark(options: {
  config: BenchmarkConfig; mode: BenchmarkReport['mode']; gitCommit?: string | null; caller?: TrialCaller
  checkpoint?: (report: BenchmarkReport) => Promise<void>
}): Promise<BenchmarkReport> {
  const schedule = trialSchedule(options.config)
  const report: BenchmarkReport = {
    version: 2, benchmarkId: `repo-purpose-${randomUUID()}`, mode: options.mode, startedAt: new Date().toISOString(), gitCommit: options.gitCommit ?? null,
    suite: suiteManifest(), config: options.config, expectedCalls: schedule.length, rows: [], limitations: LIMITATIONS,
    generationSettings: options.config.models.map((model) => ({ model, specialist: repoGenerationSettings(model), synthesis: repoGenerationSettings(model, true) })),
  }
  const caller = options.caller ?? callProductionTrial
  if (options.mode === 'mock' && !options.caller) throw new Error('Mock benchmarks require an explicit fake caller; no API calls are permitted')
  await options.checkpoint?.(report)
  for (const trial of schedule) {
    const fixture = repoBenchmarkFixtures.find((item) => item.id === trial.caseId)!
    const request = benchmarkRequest(fixture, trial.purpose)
    const base = { id: digest([report.benchmarkId, trialKey(trial)]), requestedModel: trial.model, purpose: trial.purpose, caseId: trial.caseId, repetition: trial.repetition, systemSha256: digest(request.system), evidenceSha256: digest(request.evidence) }
    const start = performance.now()
    try {
      const response = await caller(trial, request)
      if (!validRepoModel(response.model) || !response.text.trim()) throw new Error('Model returned no analysis or valid identity')
      report.rows.push({ ...base, status: 'completed', actualModel: response.model, latencyMs: Math.round(performance.now() - start),
        ...(response.timeToFirstTokenMs === undefined ? {} : { timeToFirstTokenMs: response.timeToFirstTokenMs }), ...(response.usage ? { usage: response.usage } : {}),
        response: response.text, responseSha256: digest(response.text), diagnostics: scoreRepoBenchmark(fixture, response.text) })
    } catch (error) {
      report.rows.push({ ...base, status: 'error', latencyMs: Math.round(performance.now() - start), error: errorCategory(error),
        ...(error instanceof RepoModelResponseError && validRepoModel(error.model) ? { actualModel: error.model } : {}),
        ...(error instanceof RepoModelResponseError && error.usage ? { usage: error.usage } : {}) })
    }
    await options.checkpoint?.(report)
  }
  report.completedAt = new Date().toISOString()
  await options.checkpoint?.(report)
  return report
}
