import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), call: vi.fn(), stream: vi.fn(), configured: vi.fn(), usage: vi.fn() }))
vi.mock('@/lib/auth', () => ({ currentUserId: mocks.auth }))
vi.mock('@/lib/usage', () => ({ recordUsage: mocks.usage }))
vi.mock('@/lib/repo/agentProviders', () => ({ callRepoModel: mocks.call, streamRepoModel: mocks.stream }))
vi.mock('@/lib/repo/modelPolicy', () => ({ repoModelFor: () => ({ model: 'fixture-model' }), validRepoModel: () => true, assertRepoModelConfigured: mocks.configured }))
import { POST } from './route'
let counter = 0
const plan = { summary: 'Inspect the caller.', navigation: null, edits: [], checks: [], verify: [], missingEvidence: ['Show current code'] }
function request(body: unknown, origin = 'https://example.test') { return new Request('https://example.test/api/copilot/repo-live', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) }) }
beforeEach(() => {
  vi.clearAllMocks(); mocks.auth.mockResolvedValue('test-user-' + counter++); mocks.configured.mockImplementation(() => {})
  mocks.call.mockResolvedValue({ model: 'returned-fixture', text: JSON.stringify(plan) })
  mocks.stream.mockImplementation(async function* () { yield { text: 'I’ll inspect the caller first.', model: 'returned-fixture' } })
})
describe('repository guidance boundary', () => {
  it('requires sign-in before parsing or invoking providers', async () => { mocks.auth.mockResolvedValue(null); const r = await POST(request({ lane: 'say', question: 'Explain', context: 'source' })); expect(r.status).toBe(401); expect(mocks.stream).not.toHaveBeenCalled() })
  it('rejects a cross-origin authenticated request', async () => { const r = await POST(request({ lane: 'say', question: 'Explain', context: 'source' }, 'https://elsewhere.test')); expect(r.status).toBe(403); expect(mocks.call).not.toHaveBeenCalled() })
  it('rejects unknown roles and oversized contexts', async () => { expect((await POST(request({ lane: 'execute', question: 'x', context: 'source' }))).status).toBe(400); expect((await POST(request({ lane: 'say', question: 'x', context: 'a'.repeat(32001) }))).status).toBe(400) })
  it('fails closed when the model is unconfigured', async () => { mocks.configured.mockImplementation(() => { throw new Error('secret') }); const r = await POST(request({ lane: 'say', question: 'Explain', context: 'source' })); expect(r.status).toBe(503); expect(await r.text()).not.toContain('secret') })
  it('streams speech with actual model identity and a terminal event', async () => { const r = await POST(request({ lane: 'say', question: 'Explain', context: 'observed code' })); const events = (await r.text()).trim().split('\n').map(v => JSON.parse(v)); expect(events.some(e => e.type === 'delta' && e.model === 'returned-fixture')).toBe(true); expect(events.at(-1).type).toBe('done'); expect(mocks.call).not.toHaveBeenCalled() })
  it('parses the code model structured output before publishing', async () => { const r = await POST(request({ lane: 'plan', question: 'Fix', context: 'source' })); const text = await r.text(); expect(text).toContain('"type":"plan"'); expect(text).toContain('returned-fixture'); expect(mocks.stream).not.toHaveBeenCalled() })
  it('never exposes raw provider failures or accepts malformed plans', async () => { mocks.call.mockRejectedValue(new Error('private-source-secret')); const r = await POST(request({ lane: 'review', question: 'Check', context: 'source' })); const text = await r.text(); expect(text).toContain('"type":"error"'); expect(text).not.toContain('private-source-secret'); expect(text).not.toContain('"type":"done"') })
  it('does not pretend a hallucinated structured shape is a successful answer', async () => { mocks.call.mockResolvedValue({ model: 'fixture', text: '{"passed":true}' }); const text = await (await POST(request({ lane: 'plan', question: 'Fix', context: 'source' }))).text(); expect(text).toContain('"type":"error"'); expect(text).not.toContain('"type":"plan"') })
})
