import { validRepoModel, validRepoQualityGates, type RepoBenchmarkPolicy, type RepoQualityGates } from '../../lib/repo/modelPolicy'
import { parseScreenObservation, type ScreenObservation } from '../../lib/repo/screenEvidence'
import { visionFixtures } from './fixtures'
import { sha256, visionSuiteSha256, type VisionReport, type VisionRow } from './report'
import { scoreVisionFixture } from './score'

export interface VisionReview {
  version: 1
  reviewed: boolean
  reviewer: string
  reviewedAt: string
  reportSha256: string
  images: Array<{ fixture: string; sha256: string; legible: boolean; groundTruthCorrect: boolean }>
  reviewedCandidates: string[]
  rejectedSamples: string[]
  notes: string
}
export const visionSampleId = (row: Pick<VisionRow, 'requestedModel' | 'fixture' | 'repetition'>): string => `${row.requestedModel}|${row.fixture}|${row.repetition}`
export const DEFAULT_VISION_GATES: RepoQualityGates = { minDistinctCases: 8, minRepetitions: 2, minPassRate: 0.95, maxErrorRate: 0.05, maxP95LatencyMs: 12_000 }

export function visionReviewTemplate(reportText: string): VisionReview {
  const report = JSON.parse(reportText) as VisionReport
  validateReport(report)
  return {
    version: 1, reviewed: false, reviewer: '', reviewedAt: '', reportSha256: sha256(reportText),
    images: report.images.map((entry) => ({ fixture: entry.fixture, sha256: entry.sha256, legible: false, groundTruthCorrect: false })),
    reviewedCandidates: [], rejectedSamples: [], notes: '',
  }
}

function validateReport(report: VisionReport): void {
  const ids = visionFixtures.map((fixture) => fixture.id)
  if (!report || report.version !== 1 || report.purpose !== 'vision' || !report.complete || report.suiteSha256 !== visionSuiteSha256()
    || typeof report.benchmarkId !== 'string' || !report.benchmarkId.trim() || !Array.isArray(report.candidates) || !report.candidates.length
    || report.candidates.some((model) => !validRepoModel(model) || !model.startsWith('claude-')) || new Set(report.candidates).size !== report.candidates.length
    || !Number.isInteger(report.repetitions) || report.repetitions < 1 || report.repetitions > 10 || !Array.isArray(report.images) || !Array.isArray(report.rows)) {
    throw new Error('A complete current-suite vision report with explicit Claude candidates is required')
  }
  if (report.images.length !== ids.length || new Set(report.images.map((image) => image.fixture)).size !== ids.length
    || report.images.some((image) => !ids.includes(image.fixture) || !/^[a-f0-9]{64}$/.test(image.sha256))) throw new Error('Vision report image evidence is incomplete')
  const planned = ids.length * report.candidates.length * report.repetitions
  if (report.plannedCalls !== planned || report.rows.length !== planned || new Set(report.rows.map(visionSampleId)).size !== planned) throw new Error('Vision report has missing or duplicate attempts')
  for (const row of report.rows) {
    if (!report.candidates.includes(row.requestedModel) || !ids.includes(row.fixture) || !Number.isInteger(row.repetition) || row.repetition < 1 || row.repetition > report.repetitions
      || !Number.isFinite(row.latencyMs) || row.latencyMs < 0 || row.imageSha256 !== report.images.find((image) => image.fixture === row.fixture)?.sha256
      || (typeof row.error !== 'string' && (!validRepoModel(row.actualModel) || !row.actualModel.startsWith('claude-') || !row.observation))) {
      throw new Error('Vision report contains an invalid attempt')
    }
    if (!row.error) parseScreenObservation(row.observation)
  }
}

export interface VisionSelection {
  strategy: string
  candidates: Array<{ requestedModel: string; actualModel?: string; samples: number; passRate: number; errorRate: number; p95LatencyMs: number; eligible: boolean; reasons: string[] }>
  policy: RepoBenchmarkPolicy | null
}

/** Recompute ground-truth scores from observations; never trust a saved score or a model's confidence. */
export function compileVisionPolicy(reportText: string, reviewText: string, gates: RepoQualityGates = DEFAULT_VISION_GATES): VisionSelection {
  const report = JSON.parse(reportText) as VisionReport
  const review = JSON.parse(reviewText) as VisionReview
  validateReport(report)
  if (!validRepoQualityGates(gates)) throw new Error('Vision selection quality gates are invalid')
  if (!review || review.version !== 1 || review.reviewed !== true || typeof review.reviewer !== 'string' || !review.reviewer.trim()
    || typeof review.reviewedAt !== 'string' || !Number.isFinite(Date.parse(review.reviewedAt)) || review.reportSha256 !== sha256(reportText)
    || !Array.isArray(review.images) || !Array.isArray(review.reviewedCandidates) || !Array.isArray(review.rejectedSamples)) throw new Error('A completed review bound to this exact report is required')
  if (review.images.length !== report.images.length || new Set(review.images.map((image) => image.fixture)).size !== report.images.length
    || review.images.some((image) => image.legible !== true || image.groundTruthCorrect !== true || image.sha256 !== report.images.find((entry) => entry.fixture === image.fixture)?.sha256)) {
    throw new Error('Review every rendered image against its expected visible ground truth before selecting a model')
  }
  if (review.reviewedCandidates.some((candidate) => !report.candidates.includes(candidate))
    || review.rejectedSamples.some((id) => !report.rows.some((row) => visionSampleId(row) === id))) throw new Error('Review references an unknown candidate or sample')
  const rejected = new Set(review.rejectedSamples)
  const candidates = report.candidates.map((requestedModel) => {
    const rows = report.rows.filter((row) => row.requestedModel === requestedModel)
    const actualModels = [...new Set(rows.filter((row) => !row.error).map((row) => row.actualModel!))]
    const observations = new Map<string, ScreenObservation>()
    let passes = 0
    for (let repetition = 1; repetition <= report.repetitions; repetition++) for (const fixture of visionFixtures) {
      const row = rows.find((entry) => entry.repetition === repetition && entry.fixture === fixture.id)!
      if (row.error) continue
      const observation = parseScreenObservation(row.observation)
      const previous = fixture.previousFixture ? observations.get(`${repetition}:${fixture.previousFixture}`) : undefined
      if (scoreVisionFixture(fixture, observation, previous).exactFrame && !rejected.has(visionSampleId(row))) passes++
      observations.set(`${repetition}:${fixture.id}`, observation)
    }
    const samples = rows.length
    const passRate = passes / samples
    const errorRate = rows.filter((row) => Boolean(row.error)).length / samples
    const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b)
    const p95LatencyMs = latencies[Math.ceil(latencies.length * 0.95) - 1]
    const reasons = []
    if (!review.reviewedCandidates.includes(requestedModel)) reasons.push('Raw responses for this candidate have not been reviewed')
    if (actualModels.length !== 1) reasons.push('Provider returned no stable actual model identity')
    if (visionFixtures.length < gates.minDistinctCases || report.repetitions < gates.minRepetitions) reasons.push('Insufficient distinct cases or repetitions')
    if (passRate < gates.minPassRate) reasons.push('Exact-frame pass rate is below the quality gate')
    if (errorRate > gates.maxErrorRate) reasons.push('Provider error rate exceeds the quality gate')
    if (p95LatencyMs > gates.maxP95LatencyMs) reasons.push('P95 extraction latency exceeds the budget')
    return { requestedModel, ...(actualModels.length === 1 ? { actualModel: actualModels[0] } : {}), samples, passRate, errorRate, p95LatencyMs, eligible: reasons.length === 0, reasons }
  })
  const winner = candidates.filter((candidate) => candidate.eligible).sort((left, right) => left.p95LatencyMs - right.p95LatencyMs || right.passRate - left.passRate || left.requestedModel.localeCompare(right.requestedModel))[0]
  const policy: RepoBenchmarkPolicy | null = winner ? {
    version: 2, reviewed: true, reviewer: review.reviewer, reviewedAt: review.reviewedAt,
    roles: { vision: {
      model: winner.actualModel!, samples: winner.samples, benchmarkId: report.benchmarkId, qualityGates: gates,
      measurements: [{ purpose: 'vision', samples: winner.samples, distinctCases: visionFixtures.length, repetitions: report.repetitions, passRate: winner.passRate, errorRate: winner.errorRate, p95LatencyMs: winner.p95LatencyMs }],
      evidence: { reportSha256: sha256(reportText), reviewSha256: sha256(reviewText), suiteSha256: report.suiteSha256 },
    } },
  } : null
  return { strategy: 'Fastest P95 extraction among reviewed candidates passing exact-ground-truth quality and error gates; no winner if none qualify.', candidates, policy }
}
