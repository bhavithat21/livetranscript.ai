// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'
import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { evaluationModels, proposeLessons, evaluateLessonCase } from '@/lib/coach/learning/evaluate'
vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/coach/learning/evaluate', () => ({ evaluationModels: vi.fn(), proposeLessons: vi.fn(), evaluateLessonCase: vi.fn() }))
const request = (value: unknown, origin = 'https://app.test') => new Request('https://app.test/api/copilot/lessons', { method: 'POST', headers: { Origin: origin }, body: JSON.stringify(value) })
const proposal = { action: 'propose', active: [], diagnostics: { reviewed: 1, needsWork: 1, failed: 0, categories: ['directness'] } }
beforeEach(() => { vi.clearAllMocks(); vi.mocked(currentUserId).mockResolvedValue('fixture'); vi.mocked(rateLimit).mockReturnValue(true); vi.mocked(evaluationModels).mockReturnValue({ model: 'fixture-generator', judge: 'fixture-judge' }); vi.mocked(proposeLessons).mockResolvedValue(['answer-first']) })
it('authenticates and enforces origin before making evaluation calls', async () => {
  vi.mocked(currentUserId).mockResolvedValue(null)
  expect((await POST(request(proposal))).status).toBe(401)
  vi.mocked(currentUserId).mockResolvedValue('fixture')
  expect((await POST(request(proposal, 'https://other.test'))).status).toBe(403)
  expect(proposeLessons).not.toHaveBeenCalled()
})
it('enforces bounded requests and the closed tactic catalogue', async () => {
  expect((await POST(request({ ...proposal, active: ['rewrite-your-system'] }))).status).toBe(400)
  vi.mocked(rateLimit).mockReturnValue(false)
  expect((await POST(request(proposal))).status).toBe(429)
  expect(proposeLessons).not.toHaveBeenCalled()
})
it('clearly reports missing independent judge configuration', async () => {
  vi.mocked(evaluationModels).mockImplementation(() => { throw new Error('Missing judge') })
  expect((await POST(request(proposal))).status).toBe(503)
  expect(proposeLessons).not.toHaveBeenCalled()
})
it('returns a proposed tactic without changing any live policy', async () => {
  const response = await POST(request(proposal))
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
  expect(await response.json()).toEqual({ candidate: ['answer-first'] })
  expect(proposeLessons).toHaveBeenCalledTimes(1)
  expect(evaluateLessonCase).not.toHaveBeenCalled()
})
it('does not retry failed evaluations', async () => {
  vi.mocked(proposeLessons).mockRejectedValue(new Error('Provider failed'))
  expect((await POST(request(proposal))).status).toBe(502)
  expect(proposeLessons).toHaveBeenCalledTimes(1)
})
