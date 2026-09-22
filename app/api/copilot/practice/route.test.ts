// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { currentUserId } from '@/lib/auth'
import { callRepoModel } from '@/lib/repo/agentProviders'
import { recordUsage } from '@/lib/usage'

vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn() }))
vi.mock('@/lib/repo/agentProviders', () => ({ callRepoModel: vi.fn() }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))

const base = { action: 'start', role: 'Staff engineer', kind: 'behavioral', context: '', turns: [] }
const answer = 'I wrote a migration checklist and rehearsed rollback with the on-call engineer.'
const feedback = {
  summary: 'You named a concrete action. Explain the outcome next.',
  rubric: [
    { criterion: 'Ownership', score: 4, evidence: 'I wrote a migration checklist', suggestion: 'Explain how you selected the checklist steps.' },
    { criterion: 'Outcome', score: null, evidence: '', suggestion: 'Describe what happened during the migration.' },
  ], strength: 'You involved the on-call engineer.', nextStep: 'Connect the action to its result.',
}
const request = (body: unknown, signal?: AbortSignal) => new Request('https://app.test/api/copilot/practice', { method: 'POST', body: JSON.stringify(body), signal })
function modelResponse(value: unknown) { vi.mocked(callRepoModel).mockResolvedValue({ text: JSON.stringify(value), model: 'claude-actual-model' }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(currentUserId).mockResolvedValue('user-123')
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  vi.stubEnv('OPENAI_API_KEY', '')
  vi.stubEnv('GROQ_API_KEY', '')
  vi.stubEnv('COPILOT_PRACTICE_MODEL', '')
  vi.stubEnv('COPILOT_MODEL_SMART', 'claude-sonnet-5')
})
afterEach(() => vi.unstubAllEnvs())

describe('practice coach endpoint', () => {
  it('authenticates before parsing or spending model calls', async () => {
    vi.mocked(currentUserId).mockResolvedValue(null)
    const response = await POST(request(null))
    expect(response.status).toBe(401)
    expect(callRepoModel).not.toHaveBeenCalled()
  })
  it('rejects invalid type, overlong evidence, malformed turns and incompatible actions', async () => {
    for (const value of [null, [], { ...base, kind: 'pressure-spoofing' }, { ...base, role: '' }, { ...base, turns: [null] }, { ...base, action: 'report' }, { ...base, action: 'answer', question: 'Why?' }, { ...base, turns: [{ question: 'Why?', answer }] }]) {
      expect((await POST(request(value))).status).toBe(400)
    }
    expect((await POST(request({ ...base, context: 'a'.repeat(26_001) }))).status).toBe(413)
    expect((await POST(request({ ...base, action: 'answer', question: 'Why?', answer: 'a'.repeat(6_001) }))).status).toBe(413)
    expect(callRepoModel).not.toHaveBeenCalled()
  })
  it('reports configuration failure rather than pretending the coach ran', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await POST(request(base))).status).toBe(503)
    expect(callRepoModel).not.toHaveBeenCalled()
  })
  it('sends bounded role/context evidence and reports the provider model actually used', async () => {
    modelResponse({ question: 'Tell me about a risky migration you led.', focus: 'Ownership' })
    const response = await POST(request({ ...base, context: 'Resume: payments engineer' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ question: 'Tell me about a risky migration you led.', focus: 'Ownership', model: 'claude-actual-model' })
    expect(callRepoModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-sonnet-5', evidence: expect.stringContaining('payments engineer'), signal: expect.any(AbortSignal) }))
    expect(recordUsage).toHaveBeenCalledWith('practice', 'user-123', { action: 'start', kind: 'behavioral', model: 'claude-actual-model' })
    expect(response.headers.get('cache-control')).toBe('no-store')
  })
  it('only returns scored rubric judgments with verified excerpts from the latest candidate answer', async () => {
    modelResponse({ question: 'What changed after that migration?', focus: 'Outcomes', feedback })
    const input = { ...base, action: 'answer', question: 'Tell me about a risky migration you led.', answer }
    expect((await POST(request(input))).status).toBe(200)
    modelResponse({ question: 'What changed?', focus: 'Outcomes', feedback: { ...feedback, rubric: [{ ...feedback.rubric[0], evidence: 'Revenue improved by 30%' }, feedback.rubric[1]] } })
    expect((await POST(request(input))).status).toBe(502)
    modelResponse({ question: 'What changed?', focus: 'Outcomes', feedback: { ...feedback, rubric: [{ ...feedback.rubric[0], evidence: '' }, feedback.rubric[1]] } })
    expect((await POST(request(input))).status).toBe(502)
  })
  it('ties review highlights to a real numbered turn and exact answer text', async () => {
    const input = { ...base, action: 'report', turns: [{ question: 'Tell me about a migration.', answer }] }
    const report = { summary: 'You discussed the rollout plan but left the outcome open.', highlights: [{ turn: 1, quote: 'rehearsed rollback', observation: 'A concrete risk-reduction step.' }], practiceNext: ['Add the migration result to this story.'] }
    modelResponse({ report })
    expect((await POST(request(input))).status).toBe(200)
    modelResponse({ report: { ...report, highlights: [{ ...report.highlights[0], turn: 2 }] } })
    expect((await POST(request(input))).status).toBe(502)
    modelResponse({ report: { ...report, highlights: [{ ...report.highlights[0], quote: 'I passed the interview.' }] } })
    expect((await POST(request(input))).status).toBe(502)
  })
  it('forwards request cancellation and suppresses incomplete provider output', async () => {
    const abort = new AbortController()
    vi.mocked(callRepoModel).mockImplementation(async ({ signal }) => {
      abort.abort()
      signal.throwIfAborted()
      return { text: '{}', model: 'claude-sonnet-5' }
    })
    expect((await POST(request(base, abort.signal))).status).toBe(504)
    expect(recordUsage).not.toHaveBeenCalled()
  })
  it('ends after the eighth answer and rejects attempts to continue the same session', async () => {
    const turn = { question: 'Tell me about a migration.', answer }
    modelResponse({ question: '', focus: '', feedback })
    const response = await POST(request({ ...base, action: 'answer', turns: Array.from({ length: 7 }, () => turn), ...turn }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ question: '', focus: '', feedback })
    expect((await POST(request({ ...base, action: 'answer', turns: Array.from({ length: 8 }, () => turn), ...turn }))).status).toBe(400)
  })
})
