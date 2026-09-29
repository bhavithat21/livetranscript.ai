// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest'
let client: typeof import('./client')
const fetchMock = vi.fn()
beforeEach(async () => { vi.useFakeTimers(); vi.resetModules(); localStorage.clear(); fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); client = await import('./client') })
afterEach(() => { client.setDiagnosticsEnabled(false); vi.useRealTimers(); vi.unstubAllGlobals() })
it('does nothing before explicit runtime activation', async () => {
  client.recordDiagnostic('audio', 'start')
  expect(client.getDiagnostics().events).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(6000)
  expect(fetchMock).not.toHaveBeenCalled()
})
it('batches metadata and requires an acknowledgement', async () => {
  client.initializeDiagnostics(); client.recordDiagnostic('audio', 'ready', { channel: 'mic', transcript: 'SECRET', key: 'SECRET' })
  expect(fetchMock).not.toHaveBeenCalled()
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accepted: 1 }) })
  await vi.advanceTimersByTimeAsync(5000)
  expect(client.getDiagnostics()).toMatchObject({ delivery: 'sent', pending: 0 })
  expect(fetchMock.mock.calls[0][1].body).not.toContain('SECRET')
  expect(fetchMock.mock.calls[0][0]).toBe('/api/diagnostics')
})
it('retains local diagnostics when delivery fails, with no recursive error upload', async () => {
  client.initializeDiagnostics(); client.recordDiagnostic('audio', 'error', { code: 'permission_denied' })
  fetchMock.mockRejectedValue(new Error('network SECRET'))
  expect(await client.flushDiagnostics()).toBe(false)
  expect(client.getDiagnostics()).toMatchObject({ delivery: 'failed', pending: 1 })
  expect(client.getDiagnostics().events).toHaveLength(1)
  expect(client.exportDiagnostics()).not.toContain('SECRET')
  await vi.advanceTimersByTimeAsync(9999); expect(fetchMock).toHaveBeenCalledTimes(1)
})
it('deduplicates concurrent flushes and ignores late receipt after disabling', async () => {
  client.initializeDiagnostics(); client.recordDiagnostic('audio', 'start')
  let done!: (value: unknown) => void
  fetchMock.mockReturnValue(new Promise(resolve => { done = resolve }))
  const first = client.flushDiagnostics(); expect(client.flushDiagnostics()).toBe(first)
  client.setDiagnosticsEnabled(false)
  done({ ok: true, json: async () => ({ accepted: 1 }) })
  await first
  client.recordDiagnostic('audio', 'error')
  expect(client.getDiagnostics()).toMatchObject({ enabled: false, pending: 0, delivery: 'local-only' })
  expect(client.getDiagnostics().events).toHaveLength(0)
  await vi.advanceTimersByTimeAsync(60_000); expect(fetchMock).toHaveBeenCalledTimes(1)
})
it('bounds local history and pending uploads independently', () => {
  client.initializeDiagnostics()
  for (let i = 0; i < 610; i++) client.recordDiagnostic('screen', 'heartbeat', { frames: i })
  expect(client.getDiagnostics().events).toHaveLength(600)
  expect(client.getDiagnostics()).toMatchObject({ pending: 100, dropped: 510 })
})
it('restores only validated unexpired events without queueing old sessions', async () => {
  const id = '2b92d2b4-2299-441d-8999-5c9bef381803'
  const event = { v: 1, sessionId: id, operationId: id, seq: 1, at: Date.now(), stage: 'audio', event: 'start', attrs: {} }
  localStorage.setItem('lt.diagnostics.v1', JSON.stringify([event, { ...event, seq: 2, at: Date.now() - 86_400_001 }, { ...event, seq: 3, attrs: { message: 'SECRET' } }]))
  client.initializeDiagnostics()
  expect(client.getDiagnostics().events).toHaveLength(1)
  expect(client.getDiagnostics().pending).toBe(0)
  expect(client.getDiagnostics().sessionId).not.toBe(id)
  await vi.advanceTimersByTimeAsync(6000); expect(fetchMock).not.toHaveBeenCalled()
})
it('records one terminal outcome per operation and never includes error content', () => {
  client.initializeDiagnostics()
  const trace = client.diagnosticSpan('screen_model')
  expect(trace.headers()['x-lt-session-id']).toBe(client.getDiagnostics().sessionId)
  trace.failure(new Error('invalid evidence SECRET')); trace.end('success'); trace.event('heartbeat')
  expect(client.getDiagnostics().events.map(item => item.event)).toEqual(['start', 'error'])
  expect(client.exportDiagnostics()).not.toContain('SECRET')
})
it('rejects a receipt mismatch without dropping pending events', async () => {
  client.initializeDiagnostics(); client.recordDiagnostic('audio', 'ready')
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ accepted: 0 }) })
  expect(await client.flushDiagnostics()).toBe(false)
  expect(client.getDiagnostics()).toMatchObject({ pending: 1, delivery: 'failed' })
})
