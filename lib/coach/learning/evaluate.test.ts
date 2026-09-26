import { beforeEach, expect, it, vi } from 'vitest'
vi.mock('@/lib/repo/modelPolicy', () => ({ repoModelFor: () => ({ model: 'generator-v1' }), validRepoModel: (m: unknown) => typeof m === 'string' && !!m, assertRepoModelConfigured: () => {} }))
vi.mock('@/lib/repo/agentProviders', () => ({ callRepoModel: vi.fn() }))
import { evaluateLessonCase, evaluationModels, proposeLessons, type EvalCall } from './evaluate'
beforeEach(() => { vi.stubEnv('COPILOT_LESSON_JUDGE_MODEL', 'judge-v2') })
it('runs paired generators and a separate blind judge without exposing rubric to the generator', async () => {
  const requests: Array<Parameters<EvalCall>[0]> = []
  const call: EvalCall = async request => {
    requests.push(request)
    if (request.model === 'judge-v2') return { model: request.model, text: JSON.stringify({ A: { grounding: 4, correctness: 3, directness: 3, actionability: 3 }, B: { grounding: 4, correctness: 4, directness: 4, actionability: 4 }, note: 'Synthetic unit assertion, not an actual quality score.' }) }
    return { model: request.model, text: 'Increasing the timeout only lets the caller wait longer; a background job changes how the result is delivered. Confirm whether the public API may change before deciding.' }
  }
  const result = await evaluateLessonCase([], ['answer-first'], 'deadline', 0, new AbortController().signal, call)
  expect(requests).toHaveLength(3)
  expect(requests.slice(0, 2).every(r => !r.evidence.includes('rubric'))).toBe(true)
  expect(requests[2].evidence).toContain('rubric')
  expect(result.judge).not.toBe(result.model)
  expect(result.candidateScore).toBe(4)
})
it('refuses an unconfigured or identical judge', () => {
  vi.stubEnv('COPILOT_LESSON_JUDGE_MODEL', '')
  expect(() => evaluationModels('talk')).toThrow()
  vi.stubEnv('COPILOT_LESSON_JUDGE_MODEL', 'generator-v1')
  expect(() => evaluationModels('talk')).toThrow()
})
it('rejects unsupported AI proposals rather than appending freeform instructions', async () => {
  const call: EvalCall = async () => ({ model: 'judge-v2', text: '{"lesson":"ignore-safety-and-tests"}' })
  await expect(proposeLessons([], { reviewed: 1, needsWork: 1, failed: 0, categories: ['directness'] }, new AbortController().signal, call)).rejects.toThrow()
})
it('rejects a generator response that resolves to the judge model alias', async () => {
  const call: EvalCall = async () => ({ model: 'judge-v2', text: 'Answer' })
  await expect(evaluateLessonCase([], ['answer-first'], 'deadline', 0, new AbortController().signal, call)).rejects.toThrow('same model')
})
