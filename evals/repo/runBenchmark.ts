import { writeFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { callRepoModel } from '../../lib/repo/agentProviders'
import { repoAgentEvidence, repoAgentSystem } from '../../lib/repo/agentPrompts'
import { REPO_AGENT_ROLES, validRepoModel } from '../../lib/repo/modelPolicy'
import type { RepoAgentRole } from '../../lib/repo/agentTypes'
import { repoBenchmarkFixtures, scoreRepoBenchmark } from './fixtures'

// Opt-in: never spend model credits from a normal unit-test run.
describe.skipIf(process.env.REPO_BENCHMARK_LIVE !== '1')('live repository specialist benchmark', () => {
  it('records raw answers, task-grounding proxies and actual latency for configured candidates', async () => {
    const candidates = (process.env.REPO_BENCHMARK_MODELS ?? '').split(',').map((v) => v.trim()).filter(Boolean)
    expect(candidates.length, 'Set REPO_BENCHMARK_MODELS to model IDs available on your API accounts').toBeGreaterThan(0)
    expect(candidates.every(validRepoModel)).toBe(true)
    const roles = (process.env.REPO_BENCHMARK_ROLES ?? 'requirements,implementation,debugger,reviewer').split(',') as RepoAgentRole[]
    expect(roles.every((role) => REPO_AGENT_ROLES.includes(role))).toBe(true)
    const rows = []
    // Sequential models limit unexpected cost and provider contention. Production
    // runs roles in parallel; these timings measure isolated calls, not UX latency.
    for (const model of candidates) for (const role of roles) for (const fixture of repoBenchmarkFixtures) {
      const started = performance.now()
      try {
        const result = await callRepoModel({ model, system: repoAgentSystem(role), evidence: repoAgentEvidence(fixture.input), signal: AbortSignal.timeout(35_000) })
        rows.push({ requestedModel: model, actualModel: result.model, role, fixture: fixture.id, latencyMs: Math.round(performance.now() - started), ...scoreRepoBenchmark(fixture, result.text), response: result.text })
      } catch {
        rows.push({ requestedModel: model, role, fixture: fixture.id, latencyMs: Math.round(performance.now() - started), error: 'Provider failed or timed out' })
      }
    }
    const report = { version: 1, benchmarkId: `repo-evidence-${new Date().toISOString()}`, measuredAt: new Date().toISOString(), reviewed: false, limits: 'Three synthetic partial-repository fixtures. Keyword/path heuristics are diagnostics, not correctness scores or proof of interview success. Review raw responses for valid patches before selecting models. Does not test image OCR, code execution or end-to-end speech latency.', rows }
    await writeFile(process.env.REPO_BENCHMARK_REPORT ?? 'repo-benchmark-report.json', JSON.stringify(report, null, 2))
    expect(rows.some((row) => 'actualModel' in row), 'No provider succeeded; inspect configuration and report').toBe(true)
  })
})
