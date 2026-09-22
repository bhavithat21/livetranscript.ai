import { describe, expect, it } from 'vitest'
import { DEFAULT_REPO_MODEL, repoModelFor, type RepoBenchmarkPolicy } from './modelPolicy'

function measured(): RepoBenchmarkPolicy {
  return { version: 2, reviewed: true, reviewer: 'test-reviewer', reviewedAt: '2026-09-22T00:00:00.000Z', roles: { debugger: {
    model: 'claude-sonnet-5', samples: 6, benchmarkId: 'unit-fixture-only',
    qualityGates: { minDistinctCases: 3, minRepetitions: 2, minPassRate: 1, maxErrorRate: 0, maxP95LatencyMs: 5000 },
    measurements: [{ purpose: 'debugger', samples: 6, distinctCases: 3, repetitions: 2, passRate: 1, errorRate: 0, p95LatencyMs: 4000 }],
    evidence: { reportSha256: 'a'.repeat(64), reviewSha256: 'b'.repeat(64), suiteSha256: 'c'.repeat(64) },
  } } }
}

describe('measured repository model policy', () => {
  it('labels defaults honestly and gives explicit role config priority', () => {
    expect(repoModelFor('debugger', {})).toEqual({ model: DEFAULT_REPO_MODEL, source: 'default' })
    expect(repoModelFor('debugger', { COPILOT_REPO_MODEL_DEBUGGER: 'gpt-4.1' })).toEqual({ model: 'gpt-4.1', source: 'configured' })
  })
  it('keeps legacy administrator routing but does not mislabel it a measured winner', () => {
    const policy = { version: 1, reviewed: true, roles: { reviewer: { model: 'claude-sonnet-5', samples: 3, benchmarkId: 'local-fixtures-2026-09-22' } } }
    expect(repoModelFor('reviewer', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(policy) })).toEqual({ source: 'configured', model: 'claude-sonnet-5' })
    policy.reviewed = false
    expect(() => repoModelFor('reviewer', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(policy) })).toThrow('reviewed')
  })
  it('accepts complete v2 measurements and preserves explicit override priority', () => {
    const report = JSON.stringify(measured())
    expect(repoModelFor('debugger', { COPILOT_REPO_BENCHMARK_POLICY: report })).toMatchObject({ source: 'measured', benchmarkId: 'unit-fixture-only' })
    expect(repoModelFor('debugger', { COPILOT_REPO_BENCHMARK_POLICY: report, COPILOT_REPO_MODEL_DEBUGGER: 'gpt-5.6-sol' })).toEqual({ source: 'configured', model: 'gpt-5.6-sol' })
    expect(repoModelFor('reviewer', { COPILOT_REPO_BENCHMARK_POLICY: report })).toEqual({ source: 'default', model: DEFAULT_REPO_MODEL })
  })
  it('rejects repeated single cases, missing evidence hashes and metrics below explicit gates', () => {
    const policy = measured()
    policy.roles.debugger!.measurements[0].distinctCases = 1
    policy.roles.debugger!.measurements[0].repetitions = 6
    expect(() => repoModelFor('debugger', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(policy) })).toThrow('Incomplete measured')
    const noEvidence = measured(); noEvidence.roles.debugger!.evidence.reportSha256 = ''
    expect(() => repoModelFor('debugger', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(noEvidence) })).toThrow('Incomplete measured')
    const tooSlow = measured(); tooSlow.roles.debugger!.measurements[0].p95LatencyMs = 6000
    expect(() => repoModelFor('debugger', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(tooSlow) })).toThrow('Incomplete measured')
    const weakGate = measured(); weakGate.roles.debugger!.qualityGates.minPassRate = 0.5
    expect(() => repoModelFor('debugger', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(weakGate) })).toThrow('Incomplete measured')
  })
  it('requires navigation evidence for requirements and restricts vision to Claude', () => {
    const policy = measured(); const value = policy.roles.debugger!
    value.measurements[0].purpose = 'requirements'
    policy.roles.requirements = value; delete policy.roles.debugger
    expect(() => repoModelFor('requirements', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(policy) })).toThrow('Incomplete measured')
    const vision = measured(); const visionValue = vision.roles.debugger!
    visionValue.measurements[0].purpose = 'vision'; vision.roles.vision = visionValue; delete vision.roles.debugger
    expect(repoModelFor('vision', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(vision) })).toMatchObject({ source: 'measured' })
    visionValue.model = 'gpt-5.6-sol'
    expect(() => repoModelFor('vision', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(vision) })).toThrow('Incomplete measured')
  })
  it('rejects invalid model ids and invented one-sample policies', () => {
    expect(() => repoModelFor('vision', { COPILOT_REPO_MODEL_VISION: 'https://host?key=bad' })).toThrow()
    expect(() => repoModelFor('reviewer', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify({ version: 1, reviewed: true, roles: { reviewer: { model: 'gpt-4.1', samples: 1, benchmarkId: 'weak' } } }) })).toThrow('Incomplete')
  })
})
