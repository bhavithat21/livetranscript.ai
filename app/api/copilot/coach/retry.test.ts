// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { POST } from './route'
import { callRepoModel, streamRepoModel } from '@/lib/repo/agentProviders'
import { emptyCoach, reduceCoach } from '@/lib/coach/state'
import { buildContext } from '@/lib/coach/context'
vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn(async () => 'fixture') }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn(() => true) }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
vi.mock('@/lib/repo/agentProviders', () => ({ callRepoModel: vi.fn(), streamRepoModel: vi.fn() }))
function request(lane = 'guide') {
  let state = emptyCoach('fixture')
  state = reduceCoach(state, { type: 'session.start', id: '1', at: 1, sessionId: 'fixture', permission: 'practice', objective: 'Review code' })
  state = reduceCoach(state, { type: 'question.new', id: '2', at: 2, sessionId: 'fixture', original: 'What should change?', text: 'What should change?' })
  return new Request('https://app.test/api/copilot/coach', { method: 'POST', headers: { Origin: 'https://app.test' }, body: JSON.stringify({ lane, context: buildContext(state) }) })
}
async function events(response: Response) { return (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-key')
  for (const lane of ['TALK', 'GUIDE', 'REVIEW']) vi.stubEnv(`COPILOT_COACH_${lane}_MODEL`, 'claude-fixture')
})
afterEach(() => vi.unstubAllEnvs())
it.each([429, 500, 502, 503, 504, 529])('marks transient provider %i retryable before output', async status => {
  vi.mocked(callRepoModel).mockRejectedValue(Object.assign(new Error('PRIVATE_PROVIDER_ERROR'), { status, headers: new Headers({ 'retry-after': '2' }) }))
  const output = await events(await POST(request()))
  expect(output.at(-1)).toMatchObject({ type: 'error', retryable: true, status, retryAfterMs: 2000 })
  expect(JSON.stringify(output)).not.toContain('PRIVATE_PROVIDER_ERROR')
})
it.each([400, 401, 403, 404, 422])('does not retry provider %i', async status => {
  vi.mocked(callRepoModel).mockRejectedValue(Object.assign(new Error('provider error'), { status }))
  expect((await events(await POST(request()))).at(-1)).toMatchObject({ type: 'error', retryable: false })
})
it('does not retry a provider failure after a visible delta', async () => {
  vi.mocked(streamRepoModel).mockImplementation(async function* () { yield { text: 'Partial answer', model: 'claude-fixture' }; throw Object.assign(new Error('Busy'), { status: 503 }) })
  expect((await events(await POST(request('talk')))).at(-1)).toMatchObject({ type: 'error', retryable: false })
})
it('marks missing model configuration permanently unavailable', async () => {
  vi.stubEnv('ANTHROPIC_API_KEY', '')
  const response = await POST(request())
  expect(response.status).toBe(503); expect(response.headers.get('x-lt-retryable')).toBe('false')
})
