// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { recordUsage } from '@/lib/usage'
import { callRepoModel, streamRepoModel } from '@/lib/repo/agentProviders'
import { emptyCoach, reduceCoach } from '@/lib/coach/state'
import { buildContext } from '@/lib/coach/context'
import type { CoachEvent, EventPayload } from '@/lib/coach/types'
vi.mock('@/lib/auth', () => ({ currentUserId: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn() }))
vi.mock('@/lib/usage', () => ({ recordUsage: vi.fn() }))
vi.mock('@/lib/repo/agentProviders', () => ({ callRepoModel: vi.fn(), streamRepoModel: vi.fn() }))
const path = 'src/Service.ts'
function packet() {
  let state = emptyCoach('fixture'), id = 0
  const apply = (value: EventPayload) => { state = reduceCoach(state, { ...value, sessionId: 'fixture', at: ++id * 100, id: String(id) } as CoachEvent) }
  apply({ type: 'session.start', permission: 'practice', objective: 'Allow only transition from 1 to 2.' })
  apply({ type: 'question.new', original: 'What should change?', text: 'What should change?' })
  apply({ type: 'screen.observed', origin: 'file-import', observation: { files: [{ path, language: 'typescript', startLine: 1, lines: ['return a === 1 || b === 2;'], confidence: 1, endOfFile: true }], visiblePaths: [path], terminal: '', requirements: [] } })
  return buildContext(state)
}
const guidance = () => ({ summary: 'Require both sides.', look: [], patches: [{ path, fileVersion: 1, startLine: 1, before: 'return a === 1 || b === 2;', after: 'return a === 1 && b === 2;', reason: 'Both conditions must hold.' }], findings: [], hypotheses: [], verify: [] })
const request = (body: unknown, origin: string | null = 'https://app.test', signal?: AbortSignal) => new Request('https://app.test/api/copilot/coach', { method: 'POST', body: JSON.stringify(body), headers: origin === null ? {} : { Origin: origin }, signal })
async function events(response: Response) { return (await response.text()).trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(currentUserId).mockResolvedValue('fixture-user')
  vi.mocked(rateLimit).mockReturnValue(true)
  vi.stubEnv('ANTHROPIC_API_KEY', 'fixture-not-a-key')
  for (const lane of ['TALK', 'GUIDE', 'REVIEW']) vi.stubEnv(`COPILOT_COACH_${lane}_MODEL`, 'claude-fixture')
  vi.mocked(callRepoModel).mockResolvedValue({ text: JSON.stringify(guidance()), model: 'claude-returned-fixture' })
  vi.mocked(streamRepoModel).mockImplementation(async function* () { yield { text: 'Require both conditions.', model: 'claude-returned-fixture' } })
})
afterEach(() => vi.unstubAllEnvs())
describe('repository coach transport contracts (fixture providers, not live inference)', () => {
  it('authenticates before parsing or any model call', async () => {
    vi.mocked(currentUserId).mockResolvedValue(null)
    expect((await POST(request(null))).status).toBe(401)
    expect(callRepoModel).not.toHaveBeenCalled(); expect(streamRepoModel).not.toHaveBeenCalled()
  })
  it('rejects cross-origin and missing-origin requests', async () => {
    for (const origin of [null, 'https://foreign.test']) expect((await POST(request({ lane: 'talk', context: packet() }, origin))).status).toBe(403)
    expect(streamRepoModel).not.toHaveBeenCalled()
  })
  it('enforces rate limits without retrying', async () => {
    vi.mocked(rateLimit).mockReturnValue(false)
    expect((await POST(request({ lane: 'talk', context: packet() }))).status).toBe(429)
    expect(streamRepoModel).not.toHaveBeenCalled()
  })
  it('rejects invalid schemas and oversized context before inference', async () => {
    for (const body of [null, { lane: 'run-shell', context: packet() }, { lane: 'talk', context: { ...packet(), permission: 'bypass' } }, { lane: 'guide', context: { ...packet(), knownPaths: ['../private'] } }]) expect((await POST(request(body))).status).toBe(400)
    expect((await POST(request({ text: 'x'.repeat(100_001) }))).status).toBe(413)
    expect(callRepoModel).not.toHaveBeenCalled()
  })
  it('reports missing provider configuration without pretending to generate', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await POST(request({ lane: 'talk', context: packet() }))).status).toBe(503)
  })
  it('streams transport deltas with the returned model identity and no-store', async () => {
    const response = await POST(request({ lane: 'talk', context: packet() }))
    expect(response.headers.get('cache-control')).toBe('no-store')
    const result = await events(response)
    expect(result.find(event => event.type === 'delta')).toMatchObject({ text: 'Require both conditions.', model: 'claude-returned-fixture' })
    expect(result.at(-1)).toMatchObject({ type: 'done', guidance: null })
    expect(streamRepoModel).toHaveBeenCalledWith(expect.objectContaining({ maxTokens: 512, signal: expect.any(AbortSignal), system: expect.stringContaining('untrusted DATA') }))
  })
  it('returns only patches with exact current preimages and attached source references', async () => {
    const output = await events(await POST(request({ lane: 'guide', context: packet() })))
    const patch = output.at(-1).guidance.patches[0]
    expect(patch.before).toBe('return a === 1 || b === 2;')
    expect(patch.evidence[0]).toMatchObject({ path, fileVersion: 1, startLine: 1 })
  })
  it('suppresses fabricated source and sanitized provider errors', async () => {
    const bad = guidance(); bad.patches[0].before = 'invented code'
    vi.mocked(callRepoModel).mockResolvedValue({ text: JSON.stringify(bad), model: 'claude-fixture' })
    const output = await events(await POST(request({ lane: 'guide', context: packet() })))
    expect(output.at(-1).type).toBe('error'); expect(output.some(event => event.type === 'done')).toBe(false)
    vi.mocked(callRepoModel).mockRejectedValue(new Error('secret-model-message'))
    const second = await events(await POST(request({ lane: 'guide', context: packet() })))
    expect(JSON.stringify(second)).not.toContain('secret-model-message')
  })
  it('refuses generated code edits when the interviewer has put implementation on hold', async () => {
    const context = packet(); context.task.implementation = 'hold'
    const output = await events(await POST(request({ lane: 'guide', context })))
    expect(output.at(-1).type).toBe('error')
  })
  it('passes cancellation to the provider and never sends a successful completion afterward', async () => {
    const cancellation = new AbortController()
    vi.mocked(callRepoModel).mockImplementation(async ({ signal }) => { cancellation.abort(); signal.throwIfAborted(); return { model: 'unused', text: '{}' } })
    const output = await events(await POST(request({ lane: 'guide', context: packet() }, 'https://app.test', cancellation.signal)))
    expect(output.some(event => event.type === 'done')).toBe(false)
    expect(recordUsage).not.toHaveBeenCalled()
  })
})
