import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestGuidance } from './client'
import { publicBenchmarkInputs, runPublicBenchmark } from './benchmark'
const plan = { summary: 'Inspect first', navigation: null, edits: [], checks: [], verify: [], missingEvidence: ['Need source'] }
const wire = (events: unknown[], chunks = 7) => {
  const bytes = new TextEncoder().encode(events.map(e => JSON.stringify(e)).join('\n') + '\n')
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += chunks) controller.enqueue(bytes.slice(i, i + chunks)); controller.close() } }), { status: 200 })
}
afterEach(() => vi.unstubAllGlobals())
describe('live repository transport', () => {
  it('parses split UTF-8 and NDJSON while measuring first visible text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => wire([{ type: 'start', model: 'fixture' }, { type: 'delta', text: 'Let’s inspect the caller.', model: 'fixture' }, { type: 'done' }])))
    const delta = vi.fn(), r = await requestGuidance('say', 'observed', 'Explain', new AbortController().signal, delta)
    expect(r.text).toBe('Let’s inspect the caller.'); expect(delta).toHaveBeenCalledTimes(1); expect(r.firstTokenMs).not.toBeNull()
  })
  it('requires a completion event before accepting a partial answer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => wire([{ type: 'delta', text: 'Incomplete', model: 'fixture' }])))
    await expect(requestGuidance('say', '', 'Explain', new AbortController().signal)).rejects.toThrow('Incomplete')
  })
  it('rejects malformed model plans and unsupported targets', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => wire([{ type: 'plan', model: 'fixture', plan: { ...plan, navigation: { path: '../../credentials', symbol: '', line: 1, reason: '' } } }, { type: 'done' }])))
    await expect(requestGuidance('plan', '', 'Explain', new AbortController().signal)).rejects.toThrow()
  })
  it('surfaces auth failures without fabricating a result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Unauthorized' }, { status: 401 })))
    await expect(requestGuidance('say', '', 'Explain', new AbortController().signal)).rejects.toThrow('Unauthorized')
  })
  it('does not accept a result after cancellation', async () => {
    const controller = new AbortController(); controller.abort()
    vi.stubGlobal('fetch', vi.fn(async () => wire([{ type: 'plan', plan, model: 'fixture' }, { type: 'done' }])))
    await expect(requestGuidance('plan', '', 'Explain', controller.signal)).rejects.toThrow()
  })
})
describe('explicit public model trials', () => {
  it('contains only public observed inputs, not reference patches or scores', () => {
    for (const input of publicBenchmarkInputs()) { expect(input.state.plan).toBeNull(); expect(input.state.say).toBeNull(); expect(input.state.feedback).toHaveLength(0); expect(input.state.edits).toHaveLength(0) }
  })
  it('runs exactly six requests and never sends a rubric or expected solution', async () => {
    const transport = vi.fn(async () => ({ text: 'I will inspect the transition.', plan, model: 'stub-not-real-model', firstTokenMs: 0 }))
    const rows = await runPublicBenchmark(new AbortController().signal, vi.fn(), transport)
    expect(rows).toHaveLength(3); expect(transport).toHaveBeenCalledTimes(6)
    for (const call of transport.mock.calls as unknown as Array<[string, string]>) { expect(call[1]).not.toContain('hasGroundedEdit'); expect(call[1]).not.toContain('referenceFiles') }
  })
  it('failed providers produce failed rows, not empty passing reports', async () => {
    const transport = vi.fn(async () => { throw new Error('private provider error') })
    const rows = await runPublicBenchmark(new AbortController().signal, vi.fn(), transport)
    expect(rows.every(r => r.status === 'failed')).toBe(true); expect(JSON.stringify(rows)).not.toContain('private provider error'); expect(transport).toHaveBeenCalledTimes(6)
  })
})
