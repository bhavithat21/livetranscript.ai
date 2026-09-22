import { describe, expect, it } from 'vitest'
import { DEFAULT_REPO_MODEL, repoModelFor } from './modelPolicy'

describe('measured repository model policy', () => {
  it('labels defaults honestly and gives explicit role config priority', () => {
    expect(repoModelFor('debugger', {})).toEqual({ model: DEFAULT_REPO_MODEL, source: 'default' })
    expect(repoModelFor('debugger', { COPILOT_REPO_MODEL_DEBUGGER: 'gpt-4.1' })).toEqual({ model: 'gpt-4.1', source: 'configured' })
  })
  it('routes from a reviewed measurement with at least three samples', () => {
    const policy = { version: 1, reviewed: true, roles: { reviewer: { model: 'claude-sonnet-5', samples: 3, benchmarkId: 'local-fixtures-2026-09-22' } } }
    expect(repoModelFor('reviewer', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(policy) })).toMatchObject({ source: 'measured', benchmarkId: policy.roles.reviewer.benchmarkId })
    policy.reviewed = false
    expect(() => repoModelFor('reviewer', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify(policy) })).toThrow('reviewed')
  })
  it('rejects invalid model ids and invented one-sample policies', () => {
    expect(() => repoModelFor('vision', { COPILOT_REPO_MODEL_VISION: 'https://host?key=bad' })).toThrow()
    expect(() => repoModelFor('reviewer', { COPILOT_REPO_BENCHMARK_POLICY: JSON.stringify({ version: 1, reviewed: true, roles: { reviewer: { model: 'gpt-4.1', samples: 1, benchmarkId: 'weak' } } }) })).toThrow('Incomplete')
  })
})
