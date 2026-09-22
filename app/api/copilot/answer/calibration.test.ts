import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), stream: vi.fn() }))
vi.mock('@/lib/auth', () => ({ currentUserId: mocks.auth }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
vi.mock('@/lib/copilot/pricing', () => ({ costDims: () => ({}) }))
vi.mock('@/lib/copilot/providers', () => ({ streamAnswer: mocks.stream }))
vi.mock('@/lib/copilot/modes', () => ({ modeProfile: () => ({ id: 'general', system: 'FIXED GROUNDING', tier: 'fast', temperature: 0, maxTokens: 200 }), modelForTier: () => 'test-model', vendorForModel: () => 'openai', fastFallbackModel: () => 'test-model', thinkingConfigFor: () => ({}) }))
import { POST } from './route'
function request(body: unknown, origin = 'https://livetranscript.ai') { return new NextRequest('https://livetranscript.ai/api/copilot/answer', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue('user'); vi.stubEnv('OPENAI_API_KEY', 'test-only'); mocks.stream.mockImplementation(() => new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('Answer')); controller.close() } })) })
afterEach(() => vi.unstubAllEnvs())
describe('shared live/mock answer calibration', () => {
  it('keeps existing mode preferences and grounding alongside bounded calibration', async () => {
    const instructions = 'i'.repeat(3989) + 'MODE_END'
    const response = await POST(request({ question: 'Test?', transcript: 'Scenario', instructions, calibration: 'c'.repeat(2000) }))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('Answer')
    const input = mocks.stream.mock.calls[0][0]
    expect(input.system).toContain('FIXED GROUNDING')
    expect(input.system).toContain('MODE_END')
    expect(input.system).toContain('c'.repeat(1500))
    expect(input.system).not.toContain('c'.repeat(1501))
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('requires authentication and same-origin requests', async () => {
    expect((await POST(request({ question: 'Test?' }, 'https://other.example'))).status).toBe(403)
    mocks.auth.mockResolvedValue(null)
    expect((await POST(request({ question: 'Test?' }))).status).toBe(401)
    expect(mocks.stream).not.toHaveBeenCalled()
  })
  it('rejects malformed input without TypeErrors or model calls', async () => {
    for (const input of [null, [], { question: {} }, { question: 123 }]) expect((await POST(request(input))).status).toBe(400)
    expect(mocks.stream).not.toHaveBeenCalled()
  })
})
