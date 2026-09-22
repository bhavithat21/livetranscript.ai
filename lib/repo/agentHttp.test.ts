// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundedText, parseRepoImage, readRepoJson } from './agentHttp'

afterEach(() => vi.useRealTimers())

describe('repository API boundaries', () => {
  it('rejects arrays/null and invalid JSON bodies', async () => {
    for (const body of ['null', '[]', '{']) await expect(readRepoJson(new Request('https://app.test', { method: 'POST', body }), 100)).rejects.toThrow()
  })
  it('enforces bytes without trusting content-length', async () => {
    const req = new Request('https://app.test', { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(300) }), headers: { 'content-length': '1' } })
    await expect(readRepoJson(req, 100)).rejects.toMatchObject({ status: 413 })
  })
  it('accepts a bounded object and refuses truncating evidence', async () => {
    await expect(readRepoJson(new Request('https://app.test', { method: 'POST', body: '{"x":1}' }), 100)).resolves.toEqual({ x: 1 })
    expect(() => boundedText('important code', 'context', 4)).toThrow('too long')
    expect(() => boundedText('   ', 'question', 10, true)).toThrow('required')
  })
  it('accepts screenshot bytes but rejects arbitrary URL and false media type', () => {
    expect(parseRepoImage('data:image/png;base64,iVBORw0KGgo=')).toMatchObject({ mediaType: 'image/png' })
    expect(() => parseRepoImage('https://internal.test/metadata')).toThrow()
    expect(() => parseRepoImage('data:image/png;base64,aGVsbG8=')).toThrow('does not match')
    expect(() => parseRepoImage('data:image/svg+xml;base64,aGVsbG8=')).toThrow()
  })
  it('rejects a stalled upload even when the bytes so far happen to form valid JSON', async () => {
    vi.useFakeTimers()
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"question":"partial upload"}')) },
    })
    const req = new Request('https://app.test', { method: 'POST', body, duplex: 'half' } as RequestInit)
    const result = readRepoJson(req, 100)
    const checked = expect(result).rejects.toMatchObject({ status: 408 })
    await vi.advanceTimersByTimeAsync(10_000)
    await checked
  })
  it('cancels a pending body read immediately when the client disconnects', async () => {
    const abort = new AbortController()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start() {}, cancel })
    const req = new Request('https://app.test', { method: 'POST', body, duplex: 'half', signal: abort.signal } as RequestInit)
    const result = readRepoJson(req, 100)
    abort.abort()
    await expect(result).rejects.toMatchObject({ status: 499 })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
