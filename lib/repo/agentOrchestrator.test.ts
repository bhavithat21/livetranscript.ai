// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RepoAgentEvent, RepoAgentInput } from './agentTypes'
import { runRepoAgents, type RepoAgentModels } from './agentOrchestrator'
import { callRepoModel, streamRepoModel } from './agentProviders'

vi.mock('./agentProviders', () => ({ callRepoModel: vi.fn(), streamRepoModel: vi.fn() }))
const input: RepoAgentInput = { question: 'Why duplicate events? Also where do I navigate?', context: 'src/order.ts:12 emit()', transcript: 'Emit only once.', task: 'debug' }
const models: RepoAgentModels = { requirements: 'req-model', implementation: 'impl-model', debugger: 'debug-model', reviewer: 'review-model', synthesis: 'synthesis-model' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(callRepoModel).mockImplementation(async ({ model }) => ({ text: `${model} evidence`, model: `${model}-actual` }))
  vi.mocked(streamRepoModel).mockImplementation(async function* () { yield { text: 'Navigate to src/order.ts:12', model: 'synthesis-actual' } })
})

describe('independent repository specialists', () => {
  it('formats the final synthesis while leaving specialist evidence gathering detailed', async () => {
    await runRepoAgents({ ...input, preferences: { format: 'keywords', tone: 'technical', followups: true } }, new AbortController().signal, () => {}, models)
    expect(vi.mocked(streamRepoModel).mock.calls[0][0].system).toContain('3–4 short, scannable keyword bullets')
    expect(vi.mocked(streamRepoModel).mock.calls[0][0].system).toContain('### Possible follow-ups')
    for (const [request] of vi.mocked(callRepoModel).mock.calls) expect(request.system).not.toContain('FINAL RESPONSE REQUIREMENTS')
  })
  it('launches independent roles concurrently and synthesizes with original evidence', async () => {
    let resolveCalls!: () => void
    const wait = new Promise<void>((resolve) => { resolveCalls = resolve })
    let started = 0
    vi.mocked(callRepoModel).mockImplementation(async ({ model }) => {
      started++
      if (started === 3) resolveCalls()
      await wait
      return { text: `${model} evidence`, model: `${model}-actual` }
    })
    const events: RepoAgentEvent[] = []
    await runRepoAgents(input, new AbortController().signal, (e) => events.push(e), models)
    expect(started).toBe(3)
    expect(callRepoModel).toHaveBeenCalledWith(expect.objectContaining({ model: 'debug-model', evidence: expect.stringContaining(input.context) }))
    expect(streamRepoModel).toHaveBeenCalledWith(expect.objectContaining({ evidence: expect.stringContaining(input.question) }))
    const synthesisEvidence = JSON.parse(vi.mocked(streamRepoModel).mock.calls[0][0].evidence)
    expect(synthesisEvidence.sourceEvidence.repositoryEvidence).toBe(input.context)
    expect(synthesisEvidence.specialistReports).toHaveLength(3)
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent', role: 'debugger', model: 'debug-model-actual', status: 'done' }))
    expect(events.at(-1)).toEqual({ type: 'done' })
  })
  it('makes failed roles visible and never retries a different model silently', async () => {
    vi.mocked(callRepoModel).mockImplementation(async ({ model }) => {
      if (model === 'review-model') throw new Error('private provider details')
      return { text: model, model }
    })
    const events: RepoAgentEvent[] = []
    await runRepoAgents(input, new AbortController().signal, (e) => events.push(e), models)
    expect(callRepoModel).toHaveBeenCalledTimes(3)
    expect(events).toContainEqual(expect.objectContaining({ role: 'reviewer', status: 'failed' }))
    expect(JSON.stringify(events)).not.toContain('private provider details')
    expect(vi.mocked(streamRepoModel).mock.calls[0][0].evidence).toContain('No opinion was obtained')
  })
  it('does not invent a completed synthesis when every specialist failed', async () => {
    vi.mocked(callRepoModel).mockRejectedValue(new Error('unavailable'))
    const events: RepoAgentEvent[] = []
    await expect(runRepoAgents(input, new AbortController().signal, (e) => events.push(e), models)).rejects.toThrow('All repository specialists failed')
    expect(streamRepoModel).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })
  it('marks a partial synthesis incomplete on a stream failure', async () => {
    vi.mocked(streamRepoModel).mockImplementation(async function* () { yield { text: 'Partial', model: 'actual-model' }; throw new Error('provider down') })
    const events: RepoAgentEvent[] = []
    await expect(runRepoAgents(input, new AbortController().signal, (e) => events.push(e), models)).rejects.toThrow('incomplete')
    expect(events).toContainEqual(expect.objectContaining({ role: 'synthesis', model: 'actual-model', status: 'failed' }))
    expect(events.some((e) => e.type === 'done')).toBe(false)
  })
  it('cancels all provider work and stops synthesis', async () => {
    const controller = new AbortController()
    vi.mocked(callRepoModel).mockImplementation(async () => { controller.abort(); throw new Error('aborted') })
    await expect(runRepoAgents(input, controller.signal, () => {}, models)).rejects.toThrow()
    expect(streamRepoModel).not.toHaveBeenCalled()
  })
})
