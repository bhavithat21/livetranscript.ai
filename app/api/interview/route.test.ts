import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { DEFAULT_CONFIG } from '@/lib/interview/session'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), generate: vi.fn(), log: vi.fn() }))
vi.mock('@/lib/auth', () => ({ currentUserId: mocks.auth }))
vi.mock('@/lib/log', () => ({ logError: mocks.log }))
vi.mock('@/lib/copilot/modes', () => ({ modelForTier: () => 'claude-test', vendorForModel: (model: string) => model === 'claude-test' ? 'anthropic' : 'openai', fastFallbackModel: () => 'gpt-test' }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.generate } } }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.generate } } } }))
import { POST } from './route'

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('https://livetranscript.ai/api/interview', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
}
const question = { action: 'question', config: DEFAULT_CONFIG, turns: [] }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue('user-one')
  mocks.generate.mockResolvedValue({ content: [{ type: 'text', text: 'Explain a difficult design trade-off.' }] })
  vi.stubEnv('ANTHROPIC_API_KEY', 'unit-test-key')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('GROQ_API_KEY', '')
})
afterEach(() => vi.unstubAllEnvs())
describe('interview API', () => {
  it('requires sign-in before calling the model', async () => {
    mocks.auth.mockResolvedValue(null)
    expect((await POST(request(question))).status).toBe(401)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects cross-origin browser requests', async () => {
    expect((await POST(request(question, { origin: 'https://other.example' }))).status).toBe(403)
    expect((await POST(request(question, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects malformed JSON and invalid fields', async () => {
    expect((await POST(new NextRequest('https://livetranscript.ai/api/interview', { method: 'POST', body: '{' }))).status).toBe(400)
    expect((await POST(request({ ...question, turns: [null] }))).status).toBe(400)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('bounds requests before model calls', async () => {
    expect((await POST(request({ text: 'x'.repeat(100_001) }))).status).toBe(413)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('returns a useful configuration error without a provider key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await POST(request(question))).status).toBe(503)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('generates one question and disables response caching', async () => {
    const response = await POST(request(question, { origin: 'https://livetranscript.ai' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ question: 'Explain a difficult design trade-off.' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.generate.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })
  it('keeps feedback requests separate from question requests', async () => {
    const response = await POST(request({ action: 'feedback', transcript: 'Candidate: We used a queue.', captureNote: 'Mock', coverage: 'Full' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toHaveProperty('feedback')
    expect(mocks.generate.mock.calls[0][0].system).toContain('evidence-grounded')
  })
  it('rejects empty responses', async () => {
    mocks.generate.mockResolvedValue({ content: [] })
    expect((await POST(request(question))).status).toBe(502)
  })
  it('does not log provider errors containing private data', async () => {
    mocks.generate.mockRejectedValue(new Error('SECRET TRANSCRIPT AND PROVIDER DATA'))
    expect((await POST(request(question))).status).toBe(502)
    expect(mocks.log.mock.calls[0][1].message).toBe('Interview provider request failed')
  })
})
