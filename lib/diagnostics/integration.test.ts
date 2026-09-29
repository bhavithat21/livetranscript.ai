// @vitest-environment jsdom
import { afterEach, beforeEach, it, expect, vi } from 'vitest'
let client: typeof import('./client')
beforeEach(async () => { vi.useFakeTimers(); vi.resetModules(); localStorage.clear(); client = await import('./client') })
afterEach(() => { client.setDiagnosticsEnabled(false); vi.useRealTimers(); vi.unstubAllGlobals() })

it('installs the optional core port and correlates a real screen transport operation without logging its contents', async () => {
  client.initializeDiagnostics()
  const { httpCapture } = await import('../coach/screen')
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ model: 'claude-fixture', observation: { files: [], visiblePaths: [], terminal: '', requirements: ['PRIVATE_REQUIREMENT'] } }), { status: 200 }))
  vi.stubGlobal('fetch', fetch)
  const image = 'data:image/png;base64,PRIVATE_IMAGE'
  await httpCapture(image, new AbortController().signal)
  const events = client.getDiagnostics().events
  expect(events.map(item => item.event)).toEqual(['start', 'success'])
  const headers = fetch.mock.calls[0][1].headers
  expect(headers['x-lt-operation-id']).toBe(events[0].operationId)
  expect(headers['x-lt-session-id']).toBe(events[0].sessionId)
  expect(events[1].operationId).toBe(events[0].operationId)
  expect(client.exportDiagnostics()).not.toContain('PRIVATE_')
})

it('does not let old operations write into a cleared or re-enabled diagnostic session', () => {
  client.initializeDiagnostics()
  const beforeClear = client.diagnosticSpan('talk')
  client.clearDiagnostics()
  beforeClear.event('first_token'); beforeClear.end('success')
  expect(beforeClear.headers()).toEqual({})
  expect(client.getDiagnostics().events).toHaveLength(0)
  const beforeDisable = client.diagnosticSpan('audio')
  client.setDiagnosticsEnabled(false); client.setDiagnosticsEnabled(true)
  beforeDisable.failure(new Error('network PRIVATE_ERROR'))
  expect(beforeDisable.headers()).toEqual({})
  expect(client.getDiagnostics().events).toHaveLength(0)
})

it('classifies cross-realm exceptions and ignores throwing getters', async () => {
  const { diagnosticCode } = await import('./schema')
  expect(diagnosticCode({ name: 'AbortError', message: 'PRIVATE_ERROR' })).toBe('cancelled')
  expect(diagnosticCode(new DOMException('PRIVATE_ERROR', 'NotAllowedError'))).toBe('permission_denied')
  expect(diagnosticCode({ get name() { throw new Error('PRIVATE_ERROR') } })).toBe('unknown')
})
