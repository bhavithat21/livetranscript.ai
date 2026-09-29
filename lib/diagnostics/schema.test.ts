import { describe, it, expect } from 'vitest'
import { sanitizeAttributes, parseDiagnosticEvent, diagnosticCode } from './schema'
const id = '2b92d2b4-2299-441d-8999-5c9bef381803'
const event = { v: 1, sessionId: id, operationId: id, seq: 1, at: 1790714000000, stage: 'screen_model', event: 'error', attrs: { code: 'invalid_lines', durationMs: 1234 } }
describe('diagnostics privacy boundary', () => {
  it('accepts bounded metadata', () => expect(parseDiagnosticEvent(event)).toEqual(event))
  it('never copies content or credentials', () => {
    const result = sanitizeAttributes({ ...event.attrs, transcript: 'SECRET', image: 'SECRET', error: 'SECRET', stack: 'SECRET', path: 'SECRET', apiKey: 'SECRET', url: 'SECRET', model: 'sk-proj-SECRET' })
    expect(result).toEqual(event.attrs)
    expect(JSON.stringify(result)).not.toContain('SECRET')
  })
  it.each(['transcript', 'image', 'message', 'stack', 'path', 'url', 'apiKey'])('rejects remote batches with extra %s metadata', key => {
    expect(() => parseDiagnosticEvent({ ...event, attrs: { ...event.attrs, [key]: 'SECRET' } })).toThrow()
  })
  it('rejects arbitrary header identifiers, events and top-level fields', () => {
    expect(() => parseDiagnosticEvent({ ...event, sessionId: 'a\nSECRET' })).toThrow()
    expect(() => parseDiagnosticEvent({ ...event, event: 'SECRET' })).toThrow()
    expect(() => parseDiagnosticEvent({ ...event, transcript: 'SECRET' })).toThrow()
  })
  it('does not allow nonfinite or negative measurements', () => expect(sanitizeAttributes({ durationMs: -1, frames: Infinity, httpStatus: 900, bytes: NaN })).toEqual({}))
  it.each([
    [new Error('Microphone permission denied SECRET'), undefined, 'permission_denied'],
    [new Error('SECRET'), 401, 'unauthorized'],
    [new Error('SECRET'), 429, 'rate_limited'],
    [new Error('SECRET'), 404, 'provider_unavailable'],
    [new DOMException('SECRET', 'AbortError'), undefined, 'cancelled'],
    [new Error('timed out SECRET'), undefined, 'timeout'],
    [new Error('SECRET'), undefined, 'unknown'],
  ])('reduces failures to fixed categories', (error, status, expected) => expect(diagnosticCode(error, status as number | undefined)).toBe(expected))
})
