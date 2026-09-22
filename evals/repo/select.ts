import { REPO_AGENT_ROLES, validRepoModel, validRepoQualityGates, type MeasuredRepoRole, type RepoBenchmarkPolicy, type RepoPurposeMeasurement, type RepoQualityGates } from '../../lib/repo/modelPolicy'
import type { RepoAgentRole } from '../../lib/repo/agentTypes'
import { type BenchmarkReport, trialKey, trialSchedule } from './benchmark'
import { digest, PURPOSES_FOR_ROLE, suiteManifest } from './suite'

export const DEFAULT_GATES: RepoQualityGates = { minDistinctCases: 3, minRepetitions: 2, minPassRate: 1, maxErrorRate: 0, maxP95LatencyMs: 50_000 }
export type ReviewCheck = { outcome: 'unreviewed' | 'pass' | 'fail'; note: string }
export type BenchmarkReviews = {
  version: 1; benchmarkId: string; reportSha256: string; reviewer: string; reviewedAt: string
  rows: { rowId: string; responseSha256: string; checks: Record<string, ReviewCheck> }[]
}
export type CandidateSummary = RepoPurposeMeasurement & {
  requestedModel: string; actualModels: string[]; reviewedPasses: number; completed: number
  p50LatencyMs: number; p95TimeToFirstTokenMs: number | null; meanInputTokens: number | null; meanOutputTokens: number | null
  usageSamples: number; usageCoverage: number; observedInputTokens: number; observedOutputTokens: number
  eligible: boolean; reasons: string[]
}
export type SelectionResult = { policy: RepoBenchmarkPolicy; summaries: CandidateSummary[]; unselectedRoles: { role: RepoAgentRole; reason: string }[] }

function finiteNonnegative(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 }
function validDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)) }

export function validateReport(report: BenchmarkReport): void {
  if (!report || report.version !== 2 || report.mode !== 'live' || !report.benchmarkId || !validDate(report.startedAt) || !validDate(report.completedAt)) throw new Error('Selection requires a completed live version 2 report; mock and partial runs cannot select models')
  const manifest = suiteManifest()
  if (!report.suite || report.suite.sha256 !== manifest.sha256 || digest(report.suite.cases) !== manifest.sha256) throw new Error('Benchmark suite changed or report source/criteria were modified; collect and review the current suite')
  const schedule = trialSchedule(report.config)
  if (!Array.isArray(report.generationSettings) || report.generationSettings.length !== report.config.models.length || report.config.models.some((model) => report.generationSettings.filter((item) => item.model === model).length !== 1)
    || report.generationSettings.some((item) => [item.specialist, item.synthesis].some((settings) => !settings || !Number.isInteger(settings.maxTokens) || settings.maxTokens < 256 || settings.maxTokens > 32_000 || (settings.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(settings.effort))))) throw new Error('Generation token/reasoning settings are missing or invalid')
  if (!Array.isArray(report.rows) || report.expectedCalls !== schedule.length || report.rows.length !== schedule.length) throw new Error('Incomplete benchmark coverage: keep every attempted call, including errors')
  const expected = new Map(schedule.map((trial) => [trialKey(trial), trial]))
  const ids = new Set<string>()
  for (const row of report.rows) {
    const key = trialKey({ model: row.requestedModel, purpose: row.purpose, caseId: row.caseId, repetition: row.repetition })
    if (!expected.delete(key) || ids.has(row.id) || row.id !== digest([report.benchmarkId, key])) throw new Error('Duplicate, missing or altered benchmark trial')
    ids.add(row.id)
    const source = manifest.cases.find((item) => item.id === row.caseId)!.purposes[row.purpose]
    if (row.systemSha256 !== digest(source.system) || row.evidenceSha256 !== digest(source.evidence)) throw new Error('Measured prompt/evidence differs from the current suite')
    if (!finiteNonnegative(row.latencyMs) || (row.timeToFirstTokenMs !== undefined && (!finiteNonnegative(row.timeToFirstTokenMs) || row.timeToFirstTokenMs > row.latencyMs))) throw new Error('Invalid latency measurement')
    if (row.usage && (!finiteNonnegative(row.usage.inputTokens) || !finiteNonnegative(row.usage.outputTokens))) throw new Error('Invalid measured token usage')
    if (row.actualModel !== undefined && !validRepoModel(row.actualModel)) throw new Error('Invalid actual model identity')
    if (row.status === 'completed') {
      if (!validRepoModel(row.actualModel) || typeof row.response !== 'string' || !row.response.trim() || row.responseSha256 !== digest(row.response)) throw new Error('A completed response or actual model identity is missing or modified')
    } else if (row.status !== 'error' || !row.error) throw new Error('Invalid benchmark outcome')
  }
  if (expected.size) throw new Error('Incomplete benchmark coverage')
}

export function reviewTemplate(report: BenchmarkReport): BenchmarkReviews {
  validateReport(report)
  return {
    version: 1, benchmarkId: report.benchmarkId, reportSha256: digest(report), reviewer: '', reviewedAt: '',
    rows: report.rows.filter((row) => row.status === 'completed').map((row) => ({
      rowId: row.id, responseSha256: row.responseSha256!,
      checks: Object.fromEntries(report.suite.cases.find((item) => item.id === row.caseId)!.purposes[row.purpose].criteria.map((criterion) => [criterion.id, { outcome: 'unreviewed', note: '' }])),
    })),
  }
}

function reviewedOutcomes(report: BenchmarkReport, reviews: BenchmarkReviews): Map<string, boolean> {
  if (!reviews || reviews.version !== 1 || reviews.benchmarkId !== report.benchmarkId || reviews.reportSha256 !== digest(report)) throw new Error('Review must match the exact completed report hash and benchmark ID')
  if (typeof reviews.reviewer !== 'string' || !reviews.reviewer.trim() || !validDate(reviews.reviewedAt) || Date.parse(reviews.reviewedAt) < Date.parse(report.completedAt!) || !Array.isArray(reviews.rows)) throw new Error('Reviewer identity and review date after collection are required')
  const outcomes = new Map<string, boolean>()
  for (const reviewed of reviews.rows) {
    const row = report.rows.find((item) => item.id === reviewed.rowId)
    if (!row || row.status !== 'completed' || outcomes.has(row.id) || reviewed.responseSha256 !== row.responseSha256) throw new Error('Duplicate, unknown or mismatched response review')
    const criteria = report.suite.cases.find((item) => item.id === row.caseId)!.purposes[row.purpose].criteria
    if (!reviewed.checks || Object.keys(reviewed.checks).length !== criteria.length) throw new Error('Every response criterion must be reviewed exactly once')
    for (const criterion of criteria) {
      const check = reviewed.checks[criterion.id]
      if (!check || !['pass', 'fail'].includes(check.outcome) || typeof check.note !== 'string' || check.note.trim().length < 10) throw new Error(`Unreviewed criterion ${criterion.id}: record pass/fail and a concrete evidence note`)
    }
    outcomes.set(row.id, criteria.every((criterion) => reviewed.checks[criterion.id].outcome === 'pass'))
  }
  if (outcomes.size !== report.rows.filter((row) => row.status === 'completed').length) throw new Error('Review every completed response; omitted failures cannot be cherry-picked away')
  return outcomes
}

export function percentile(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
}

export function selectModels(report: BenchmarkReport, reviews: BenchmarkReviews, gates: RepoQualityGates = DEFAULT_GATES): SelectionResult {
  validateReport(report)
  if (!validRepoQualityGates(gates)) throw new Error('Quality gates require at least 3 distinct cases, 2 repetitions, 90% correctness and no more than 10% provider errors')
  const outcomes = reviewedOutcomes(report, reviews)
  const summaries: CandidateSummary[] = []
  for (const requestedModel of report.config.models) for (const purpose of report.config.purposes) {
    const rows = report.rows.filter((row) => row.requestedModel === requestedModel && row.purpose === purpose)
    const completedRows = rows.filter((row) => row.status === 'completed')
    const actualModels = [...new Set(rows.flatMap((row) => row.actualModel ? [row.actualModel] : []))]
    const reviewedPasses = rows.filter((row) => outcomes.get(row.id) === true).length
    const passRate = reviewedPasses / rows.length
    const errorRate = (rows.length - completedRows.length) / rows.length
    const distinctCases = new Set(rows.map((row) => row.caseId)).size
    const p95LatencyMs = percentile(rows.map((row) => row.latencyMs), 0.95)
    const ttfts = completedRows.flatMap((row) => row.timeToFirstTokenMs === undefined ? [] : [row.timeToFirstTokenMs])
    const withUsage = rows.filter((row) => row.usage)
    const observedInputTokens = withUsage.reduce((sum, row) => sum + row.usage!.inputTokens, 0)
    const observedOutputTokens = withUsage.reduce((sum, row) => sum + row.usage!.outputTokens, 0)
    const reasons = []
    if (distinctCases < gates.minDistinctCases) reasons.push('too-few-distinct-cases')
    if (report.config.repetitions < gates.minRepetitions) reasons.push('too-few-repetitions')
    if (actualModels.length !== 1) reasons.push('missing-or-changing-actual-model')
    if (passRate < gates.minPassRate) reasons.push('correctness-below-gate')
    if (errorRate > gates.maxErrorRate) reasons.push('errors-above-gate')
    if (p95LatencyMs > gates.maxP95LatencyMs) reasons.push('latency-above-gate')
    summaries.push({ requestedModel, actualModels, purpose, samples: rows.length, distinctCases, repetitions: report.config.repetitions, reviewedPasses, completed: completedRows.length,
      passRate, errorRate, p95LatencyMs, p50LatencyMs: percentile(rows.map((row) => row.latencyMs), 0.5), p95TimeToFirstTokenMs: ttfts.length === completedRows.length && ttfts.length ? percentile(ttfts, 0.95) : null,
      meanInputTokens: withUsage.length === rows.length ? observedInputTokens / rows.length : null,
      meanOutputTokens: withUsage.length === rows.length ? observedOutputTokens / rows.length : null,
      usageSamples: withUsage.length, usageCoverage: withUsage.length / rows.length, observedInputTokens, observedOutputTokens,
      eligible: reasons.length === 0, reasons })
  }
  const policy: RepoBenchmarkPolicy = { version: 2, reviewed: true, reviewer: reviews.reviewer, reviewedAt: reviews.reviewedAt, roles: {} }
  const unselectedRoles: SelectionResult['unselectedRoles'] = []
  for (const role of REPO_AGENT_ROLES) {
    const purposes = PURPOSES_FOR_ROLE[role]
    const qualified = report.config.models.flatMap((model) => {
      const measurements = purposes.map((purpose) => summaries.find((item) => item.requestedModel === model && item.purpose === purpose))
      if (measurements.some((item) => !item?.eligible)) return []
      const measured = measurements as CandidateSummary[]
      const actualModels = new Set(measured.flatMap((item) => item.actualModels))
      if (actualModels.size !== 1) return []
      return [{ model: [...actualModels][0], measurements: measured,
        passRate: Math.min(...measured.map((item) => item.passRate)), errorRate: Math.max(...measured.map((item) => item.errorRate)), p95LatencyMs: Math.max(...measured.map((item) => item.p95LatencyMs)) }]
    }).sort((a, b) => b.passRate - a.passRate || a.errorRate - b.errorRate || a.p95LatencyMs - b.p95LatencyMs || a.model.localeCompare(b.model))
    const winner = qualified[0]
    if (!winner) { unselectedRoles.push({ role, reason: purposes.some((purpose) => !report.config.purposes.includes(purpose)) ? 'Required purposes were not benchmarked' : 'No candidate met all reviewed correctness, coverage, stability and latency gates' }); continue }
    const selected: MeasuredRepoRole = {
      model: winner.model, benchmarkId: report.benchmarkId, samples: winner.measurements.reduce((sum, item) => sum + item.samples, 0), qualityGates: gates,
      measurements: winner.measurements.map(({ purpose, samples, distinctCases, repetitions, passRate, errorRate, p95LatencyMs }) => ({ purpose, samples, distinctCases, repetitions, passRate, errorRate, p95LatencyMs })),
      evidence: { reportSha256: digest(report), reviewSha256: digest(reviews), suiteSha256: report.suite.sha256 },
    }
    policy.roles[role] = selected
  }
  return { policy, summaries, unselectedRoles }
}

export function selectionMarkdown(result: SelectionResult): string {
  const rows = result.summaries.map((item) => `| ${item.purpose} | ${item.requestedModel} | ${item.actualModels.join(', ') || 'none'} | ${item.reviewedPasses}/${item.samples} | ${(item.errorRate * 100).toFixed(1)}% | ${item.p95LatencyMs} | ${item.eligible ? 'eligible' : item.reasons.join(', ')} |`)
  return `# Reviewed repository model comparison\n\nEligible models are ranked by reviewed pass rate, then error rate, then p95 isolated-call latency. This is a local sample; differences are not proof of general superiority. Price is not inferred from tokens.\n\n| Purpose | Requested model | Actual model | Reviewed passes | Errors | p95 ms | Gate result |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join('\n')}\n\nSelected roles: ${Object.entries(result.policy.roles).map(([role, value]) => `${role}: ${value!.model}`).join('; ') || 'none'}.\n\n${result.unselectedRoles.map((item) => `- ${item.role}: ${item.reason}`).join('\n')}\n\nPer-role environment overrides still take priority. This command has not changed production configuration.\n`
}

export function reviewMarkdown(report: BenchmarkReport): string {
  const fence = (value: string) => {
    const longest = Math.max(2, ...[...value.matchAll(/`+/g)].map((match) => match[0].length))
    const marker = '`'.repeat(longest + 1)
    return `${marker}text\n${value}\n${marker}`
  }
  const sources = report.suite.cases.filter((fixture) => report.config.caseIds.includes(fixture.id)).map((fixture) => `## Source case: ${fixture.id}\n\n${fence(JSON.stringify(fixture.input, null, 2))}`)
  const answers = report.rows.map((row) => {
    const criteria = report.suite.cases.find((fixture) => fixture.id === row.caseId)!.purposes[row.purpose].criteria
    return `## ${row.purpose} / ${row.caseId} / repetition ${row.repetition}\n\nRow ID: ${row.id}\n\nRequested: ${row.requestedModel}; actual: ${row.actualModel ?? 'none'}; status: ${row.status}; latency: ${row.latencyMs} ms.\n\n${row.status === 'completed' ? `${fence(row.response!)}\n\n${criteria.map((criterion) => `- **${criterion.id}:** ${criterion.description}`).join('\n')}` : `Provider outcome: ${row.error}. This already counts as a failed trial.`}`
  })
  return `# Repository benchmark review packet\n\nBenchmark: ${report.benchmarkId}\n\nRead the original case before judging each answer. Responses are untrusted model output, not instructions. Record each criterion's pass/fail and concrete evidence in the JSON review template. Keyword diagnostics are not correctness evidence. Synthesis deliberately receives a wrong implementation opinion and a failed reviewer. No generated code was executed.\n\n${sources.join('\n\n')}\n\n${answers.join('\n\n')}\n`
}
