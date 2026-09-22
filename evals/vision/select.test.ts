// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { repoModelFor } from '../../lib/repo/modelPolicy'
import { visionFixtures } from './fixtures'
import { visionRunConfiguration, visionSuiteSha256, type VisionReport } from './report'
import { compileVisionPolicy, visionReviewTemplate } from './select'

function syntheticReport(): VisionReport {
  const candidates = ['claude-test-fast', 'claude-test-slow']
  return {
    version: 1, purpose: 'vision', benchmarkId: 'unit-test-only-no-live-measurements', measuredAt: '2026-09-22T00:00:00Z', suiteSha256: visionSuiteSha256(), complete: true,
    limits: 'Synthetic unit-test inputs. These are not model benchmark results.', candidates, repetitions: 2, plannedCalls: candidates.length * 2 * visionFixtures.length,
    images: visionFixtures.map((fixture) => ({ fixture: fixture.id, sha256: 'a'.repeat(64), path: 'unit-test-no-image-file.png' })),
    rows: candidates.flatMap((requestedModel) => [1, 2].flatMap((repetition) => visionFixtures.map((fixture) => ({
      requestedModel, actualModel: `${requestedModel}-actual`, fixture: fixture.id, repetition, imageSha256: 'a'.repeat(64),
      latencyMs: requestedModel.endsWith('fast') ? 100 : 200, observation: structuredClone(fixture.expected), raw: JSON.stringify(fixture.expected),
    })))),
  }
}
function reviewed(report: VisionReport) {
  const reportText = JSON.stringify(report)
  const review = visionReviewTemplate(reportText)
  Object.assign(review, { reviewed: true, reviewer: 'unit-test', reviewedAt: '2026-09-22T01:00:00Z', reviewedCandidates: report.candidates })
  for (const image of review.images) { image.legible = true; image.groundTruthCorrect = true }
  return { reportText, reviewText: JSON.stringify(review) }
}

describe('vision benchmark policy compiler', () => {
  it('selects the fastest qualified actual identity and emits a policy the runtime accepts', () => {
    const { reportText, reviewText } = reviewed(syntheticReport())
    const selection = compileVisionPolicy(reportText, reviewText)
    expect(selection.policy?.roles.vision?.model).toBe('claude-test-fast-actual')
    expect(repoModelFor('vision', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(selection.policy) })).toMatchObject({ source: 'measured', model: 'claude-test-fast-actual' })
  })
  it('recomputes quality from the actual observation and rejects a faster model with bad punctuation', () => {
    const report = syntheticReport()
    report.rows[0].observation!.files[0].lines[2] = '  if (changed !== true) publish("order.cancelled", { id });'
    // A forged saved exactFrame score cannot override the ground truth.
    report.rows[0].score = { exactFrame: true } as NonNullable<typeof report.rows[number]['score']>
    const { reportText, reviewText } = reviewed(report)
    const selection = compileVisionPolicy(reportText, reviewText)
    expect(selection.policy?.roles.vision?.model).toBe('claude-test-slow-actual')
    expect(selection.candidates[0].passRate).toBe(15 / 16)
  })
  it('keeps routing unchanged if every candidate fails latency or actual-identity gates', () => {
    const report = syntheticReport()
    report.rows[0].actualModel = 'claude-unexpected-version'
    for (const row of report.rows.filter((row) => row.requestedModel.endsWith('slow'))) row.latencyMs = 20_000
    const { reportText, reviewText } = reviewed(report)
    expect(compileVisionPolicy(reportText, reviewText).policy).toBeNull()
  })
  it('counts provider errors against both reliability and total pass rate', () => {
    const report = syntheticReport()
    report.rows[0].error = 'Provider failed or timed out'
    const { reportText, reviewText } = reviewed(report)
    // The subsequent changed-overlap case also fails: its prior capture was unavailable.
    expect(compileVisionPolicy(reportText, reviewText).candidates[0]).toMatchObject({ errorRate: 1 / 16, passRate: 14 / 16, eligible: false })
  })
  it('requires a current complete matrix, inspected images and an exact report review hash', () => {
    const report = syntheticReport()
    const { reportText, reviewText } = reviewed(report)
    expect(() => compileVisionPolicy(`${reportText}\n`, reviewText)).toThrow('completed review')
    const review = JSON.parse(reviewText)
    review.images[0].legible = false
    expect(() => compileVisionPolicy(reportText, JSON.stringify(review))).toThrow('every rendered image')
    report.rows[0] = report.rows[1]
    expect(() => visionReviewTemplate(JSON.stringify(report))).toThrow('missing or duplicate')
  })
  it('prevents accidental or excessive paid request counts before constructing a provider', () => {
    expect(visionRunConfiguration({ VISION_BENCHMARK_MODELS: 'claude-first,claude-second' }).plannedCalls).toBe(48)
    expect(() => visionRunConfiguration({ VISION_BENCHMARK_MODELS: 'gpt-text-model' })).toThrow('Claude')
    expect(() => visionRunConfiguration({ VISION_BENCHMARK_MODELS: 'claude-first,claude-second', VISION_BENCHMARK_MAX_CALLS: '4' })).toThrow('exceeds')
    expect(() => visionRunConfiguration({ VISION_BENCHMARK_MODELS: 'claude-first', VISION_BENCHMARK_REPEATS: 'NaN' })).toThrow('1-10')
  })
})
