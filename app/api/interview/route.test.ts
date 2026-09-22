// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/lib/interview/model'
const mocks = vi.hoisted(() => ({ create: vi.fn(), user: vi.fn() }))
vi.mock('@/lib/auth', () => ({ currentUserId: mocks.user, PREVIEW_USER_ID: 'preview_user' }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.create } } } }))
import { POST } from './route'
const payload = { action: 'question', mode: 'mock', settings: DEFAULT_SETTINGS, turns: [] }
const request = (body: unknown = payload, origin = 'https://test.local') => new Request('https://test.local/api/interview', {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  mocks.create.mockReset()
  mocks.user.mockReset().mockResolvedValue('test-user')
  vi.stubEnv('OPENAI_API_KEY', 'unit-test-placeholder')
})
afterEach(() => vi.unstubAllEnvs())
describe('interview API', () => {
  it('requires matching origin before any provider call', async () => {
    expect((await POST(request(payload, 'https://elsewhere.local'))).status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('requires a real signed-in user, including in preview mode', async () => {
    for (const user of [null, 'preview_user']) {
      mocks.user.mockResolvedValue(user)
      expect((await POST(request())).status).toBe(401)
    }
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('returns a recoverable configuration error', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    expect((await POST(request())).status).toBe(503)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('rejects malformed input before billing a model', async () => {
    expect((await POST(request({ ...payload, turns: 'not an array' }))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('returns one validated question without cacheable transcript data', async () => {
    mocks.create.mockResolvedValue({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ question: 'Describe a difficult technical decision.' }) } }] })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.json()).question).toContain('technical decision')
    const input = mocks.create.mock.calls[0][0]
    expect(input.messages[0].content).toContain('untrusted')
    expect(input.messages[1].role).toBe('user')
  })
  it('does not accept truncated or invalid model output', async () => {
    for (const result of [
      { choices: [{ finish_reason: 'length', message: { content: '{}' } }] },
      { choices: [{ finish_reason: 'stop', message: { content: 'broken' } }] },
    ]) {
      mocks.create.mockResolvedValue(result)
      expect((await POST(request())).status).toBe(502)
    }
  })
  it('does not expose upstream error messages or submitted content', async () => {
    mocks.create.mockRejectedValue(new Error('private transcript / credential details'))
    const response = await POST(request())
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('credential details')
  })
})
