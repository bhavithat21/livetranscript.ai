// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { classifyQuestion, JEV_TIMEOUT_MS, parseJevClassification } from './serverClassifier'
import { POST } from '@/app/api/copilot/classify/route'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ create: vi.fn(), auth: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.create } } } }))
vi.mock('@/lib/auth', () => ({ currentUserId: mocks.auth }))
const expected = { mode: 'repoInterview', confidence: 0.96, isQuestion: true, needsWeb: false }
const env = { TYPESAFE_API_KEY: 'test-jev', OPENAI_API_KEY: 'test-openai', COPILOT_CLASSIFIER_PROVIDER: 'jev' }
function jev() { return {
  model: 'jev-1.13.0', usage: { input_tokens: 40, output_tokens: 12 }, answers: {
    mode: { type: 'choice', choice: 'repoInterview', confidence: 0.96, probabilities: { general: 0.01, repoInterview: 0.96, coding: 0.01, systemDesign: 0.01, behavioral: 0.01 } },
    isQuestion: { type: 'noul', noul: 0.99 }, needsWeb: { type: 'noul', noul: 0.01 },
  },
} }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue('user-1')
  mocks.create.mockResolvedValue({ model: 'gpt-4o-mini-actual', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(expected) } }], usage: { prompt_tokens: 50, completion_tokens: 30 } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(jev())))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('optional Jev classifier', () => {
  it('batches bounded question decisions and preserves actual model and usage', async () => {
    const response = await classifyQuestion('x'.repeat(2_000), { env })
    expect(response.result).toEqual(expected)
    expect(response.attempts).toEqual([expect.objectContaining({ provider: 'jev', model: 'jev-1.13.0', outcome: 'accepted', usage: { inputTokens: 40, outputTokens: 12 } })])
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe('https://api.typesafe.ai/v1/systemone')
    const sent = JSON.parse(init!.body as string)
    expect(sent.state).toHaveLength(1_000)
    expect(Object.keys(sent.questions)).toEqual(['mode', 'isQuestion', 'needsWeb'])
    expect(init?.redirect).toBe('error')
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('does not call Jev merely because a key exists', async () => {
    const response = await classifyQuestion('mixed question', { env: { ...env, COPILOT_CLASSIFIER_PROVIDER: undefined } })
    expect(fetch).not.toHaveBeenCalled()
    expect(response.attempts[0].provider).toBe('openai')
  })

  it('falls back on uncertain yes/no probabilities instead of discarding a question', async () => {
    const body = jev(); body.answers.isQuestion.noul = 0.5
    vi.mocked(fetch).mockResolvedValue(Response.json(body))
    const response = await classifyQuestion('mixed question', { env })
    expect(response.result).toEqual(expected)
    expect(response.attempts.map((a) => a.outcome)).toEqual(['uncertain', 'accepted'])
  })

  it.each([401, 429, 529])('falls back on provider HTTP %s without returning private error bodies', async (status) => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'private-provider-detail' }, { status }))
    const response = await classifyQuestion('mixed question', { env })
    expect(response.result).toEqual(expected)
    expect(response.attempts.map((a) => a.outcome)).toEqual(['error', 'accepted'])
    expect(JSON.stringify(response)).not.toContain('private-provider-detail')
  })

  it('cuts off a stalled Jev request before running the fallback', async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true })
    }))
    const started = performance.now()
    const response = await classifyQuestion('mixed question', { env })
    expect(response.result).toEqual(expected)
    expect(performance.now() - started).toBeLessThan(JEV_TIMEOUT_MS + 1_000)
    expect(response.attempts[0].outcome).toBe('error')
  })

  it('does not start another provider after caller cancellation', async () => {
    const controller = new AbortController()
    vi.mocked(fetch).mockImplementation(async () => { controller.abort(); throw new Error('aborted') })
    const response = await classifyQuestion('mixed question', { env, signal: controller.signal })
    expect(response.result).toBeNull()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('continues with configured legacy provider when Jev has no key', async () => {
    const response = await classifyQuestion('mixed question', { env: { ...env, TYPESAFE_API_KEY: undefined } })
    expect(response.result).toEqual(expected)
    expect(fetch).not.toHaveBeenCalled()
    expect(response.attempts[0].outcome).toBe('unconfigured')
  })

  it('returns no decision when neither provider is configured', async () => {
    expect((await classifyQuestion('mixed question', { provider: 'jev', env: {} })).result).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each(['length', 'content_filter', 'tool_calls'])('rejects incomplete legacy output (%s)', async (finish_reason) => {
    mocks.create.mockResolvedValue({ model: 'gpt-test', choices: [{ finish_reason, message: { content: JSON.stringify(expected) } }] })
    expect((await classifyQuestion('mixed question', { provider: 'legacy', env })).result).toBeNull()
  })

  it('rejects invalid distributions and out-of-range certainty', () => {
    const body = jev(); body.answers.mode.probabilities.repoInterview = 1.5
    expect(parseJevClassification(body)).toBeNull()
    const low = jev(); low.answers.mode.confidence = 0.2
    expect(parseJevClassification(low)).toBeNull()
    const wrong = jev(); wrong.answers.mode.choice = 'coding'
    expect(parseJevClassification(wrong)).toBeNull()
  })

  it('authenticates before parsing or calling providers', async () => {
    mocks.auth.mockResolvedValue(null)
    const response = await POST(new NextRequest('https://app.test/api/copilot/classify', { method: 'POST', body: '{invalid' }))
    expect(response.status).toBe(401)
    expect(fetch).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('handles null JSON and rejects malformed JSON without a 500', async () => {
    for (const [body, status] of [['null', 200], ['{invalid', 400]] as const) {
      const response = await POST(new NextRequest('https://app.test/api/copilot/classify', { method: 'POST', body }))
      expect(response.status).toBe(status)
    }
    expect(fetch).not.toHaveBeenCalled()
  })
})
