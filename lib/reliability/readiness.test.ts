import { expect, it } from 'vitest'
import { mockReadiness } from './readiness'
import type { DiagnosticEvent } from '../diagnostics/schema'
it('cannot certify a device from server success or startup flags', () => {
  const events = [{ stage: 'audio', event: 'ready', at: 100, operationId: 'a', attrs: {} }, { stage: 'app', event: 'success', at: 100, operationId: 'b', attrs: {} }] as DiagnosticEvent[]
  expect(mockReadiness(events, 0).passed).toBe(false)
})
it('requires newly finalized speech on the same operation after reconnect', () => {
  const events = [{ stage: 'transcription', event: 'retry', at: 10, operationId: 'a', attrs: {} }, { stage: 'transcription', event: 'first_final', at: 11, operationId: 'b', attrs: {} }] as DiagnosticEvent[]
  expect(mockReadiness(events, 0).checks.at(-1)?.passed).toBe(false)
  events[1].operationId = 'a'; expect(mockReadiness(events, 0).checks.at(-1)?.passed).toBe(true)
  expect(mockReadiness(events, 12).checks.at(-1)?.passed).toBe(false)
})
