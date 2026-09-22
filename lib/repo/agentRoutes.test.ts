// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as screen } from '@/app/api/copilot/repo-screen/route'
import { POST as analyze } from '@/app/api/copilot/repo-analyze/route'
import { currentUserId } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn() }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create } } }))

const request = (body: unknown) => new Request('https://app.test/api/copilot/repo-screen', { method: 'POST', body: JSON.stringify(body) })
const image = 'data:image/png;base64,iVBORw0KGgo='
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(currentUserId).mockResolvedValue('user-id')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  vi.stubEnv('COPILOT_REPO_MODEL_VISION', 'claude-sonnet-5')
})

describe('repository endpoint contracts', () => {
  it('requires authentication on both endpoints before parsing input', async () => {
    vi.mocked(currentUserId).mockResolvedValue(null)
    expect((await screen(request({ image }))).status).toBe(401)
    expect((await analyze(request({}))).status).toBe(401)
    expect(create).not.toHaveBeenCalled()
  })
  it('rejects malformed inputs without paying for model calls', async () => {
    for (const body of [null, [], { image: 'https://host.test/img.png' }]) expect((await screen(request(body))).status).toBe(400)
    expect((await analyze(request({ question: 'x', context: 'y', task: 'shell' }))).status).toBe(400)
    expect((await analyze(request({ question: 'x', context: 'a'.repeat(120_001) }))).status).toBe(413)
    expect(create).not.toHaveBeenCalled()
  })
  it('returns only validated observations and reports actual model identity', async () => {
    const observation = { files: [{ path: 'src/a.ts', language: 'typescript', startLine: 4, lines: ['return a'], confidence: 0.9, endOfFile: false }], visiblePaths: ['src/a.ts'], terminal: '', requirements: [] }
    create.mockResolvedValue({ model: 'claude-actual-version', stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(observation) }] })
    const response = await screen(request({ image }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ observation, model: 'claude-actual-version' })
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5' }), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
  it('rejects incomplete or malformed evidence instead of recording a reconstruction', async () => {
    create.mockResolvedValue({ model: 'claude-sonnet-5', stop_reason: 'end_turn', content: [{ type: 'text', text: '{"files":null}' }] })
    expect((await screen(request({ image }))).status).toBe(502)
    create.mockResolvedValue({ model: 'claude-sonnet-5', stop_reason: 'max_tokens', content: [{ type: 'text', text: '{}' }] })
    expect((await screen(request({ image }))).status).toBe(422)
  })
})
