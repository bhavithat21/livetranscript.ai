// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failurePolicy, parseRetryAfter, RequestFailure, responseFailure, retryHeaders, retryRead } from './retry'
const options = () => ({ signal: new AbortController().signal, timeoutMs: 10_000, random: () => 0.5 })
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
describe('bounded read retries', () => {
  it('recovers with exponential backoff and one shared signal', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockRejectedValueOnce(new RequestFailure('Busy', 503, true)).mockResolvedValue('ok')
    const onRetry = vi.fn(), beforeRetry = vi.fn(() => true)
    const promise = retryRead(fn, { ...options(), onRetry, beforeRetry })
    await vi.advanceTimersByTimeAsync(499); expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1); expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(promise).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
    expect(fn.mock.calls[0][0]).toBe(fn.mock.calls[2][0])
    expect(onRetry.mock.calls.map(call => call[0].delayMs)).toEqual([500, 1000])
    expect(beforeRetry).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('exhausts at exactly three attempts', async () => {
    const failure = new RequestFailure('Busy', 502, true), fn = vi.fn().mockRejectedValue(failure)
    const promise = retryRead(fn, options()).catch(error => error)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await promise).toBe(failure); expect(fn).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0)
  })
  it.each([400, 401, 403, 404, 413, 422, 501])('does not retry permanent HTTP %i', async status => {
    const fn = vi.fn().mockRejectedValue(responseFailure(new Response('', { status }), 'Rejected'))
    await expect(retryRead(fn, options())).rejects.toBeInstanceOf(Error)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('honors explicit no-retry for schema rejection or configuration 5xx', async () => {
    for (const status of [502, 503]) {
      const fn = vi.fn().mockRejectedValue(responseFailure(new Response('', { status, headers: { 'x-lt-retryable': 'false' } }), 'Not recoverable'))
      await expect(retryRead(fn, options())).rejects.toBeInstanceOf(Error); expect(fn).toHaveBeenCalledTimes(1)
    }
  })
  it('does not retry coding errors, denials or cancellation', async () => {
    for (const failure of [new TypeError('Cannot read properties'), new SyntaxError('JSON'), new DOMException('Denied', 'NotAllowedError'), new DOMException('Stopped', 'AbortError')]) {
      const fn = vi.fn().mockRejectedValue(failure)
      await expect(retryRead(fn, options())).rejects.toBe(failure); expect(fn).toHaveBeenCalledTimes(1)
    }
  })
  it('never replays visible output', async () => {
    const fn = vi.fn().mockRejectedValue(new RequestFailure('Interrupted', 502, true))
    await expect(retryRead(fn, { ...options(), canRetry: () => false })).rejects.toBeInstanceOf(Error)
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('counts retry attempts against the existing budget', async () => {
    const fn = vi.fn().mockRejectedValue(new RequestFailure('Busy', 503, true))
    const promise = retryRead(fn, { ...options(), beforeRetry: () => false }).catch(error => error)
    await vi.advanceTimersByTimeAsync(500); await promise
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('cancels during backoff without another request', async () => {
    const abort = new AbortController(), fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const promise = retryRead(fn, { ...options(), signal: abort.signal }).catch(error => error)
    await vi.advanceTimersByTimeAsync(100); abort.abort()
    expect(await promise).toHaveProperty('name', 'AbortError')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fn).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0)
  })
  it('does not begin an already cancelled operation', async () => {
    const abort = new AbortController(); abort.abort(); const fn = vi.fn()
    await expect(retryRead(fn, { ...options(), signal: abort.signal })).rejects.toHaveProperty('name', 'AbortError')
    expect(fn).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0)
  })
  it('enforces one deadline even when an operation never resolves', async () => {
    const seen: AbortSignal[] = []
    const fn = vi.fn((signal: AbortSignal) => { seen.push(signal); return new Promise(() => {}) })
    const promise = retryRead(fn, { ...options(), timeoutMs: 1000 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(1000)
    expect(await promise).toHaveProperty('name', 'TimeoutError'); expect(fn).toHaveBeenCalledTimes(1)
    expect(seen[0].aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('honors Retry-After rather than sending early', async () => {
    const fn = vi.fn().mockRejectedValueOnce(responseFailure(new Response('', { status: 429, headers: { 'Retry-After': '2' } }), 'Rate limited')).mockResolvedValue('ok')
    const promise = retryRead(fn, options())
    await vi.advanceTimersByTimeAsync(1999); expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1); await expect(promise).resolves.toBe('ok')
  })
  it('does not shorten a Retry-After longer than the deadline', async () => {
    const fn = vi.fn().mockRejectedValue(new RequestFailure('Rate limited', 429, true, 60_000)), onRetry = vi.fn()
    await expect(retryRead(fn, { ...options(), onRetry })).rejects.toBeInstanceOf(Error)
    expect(fn).toHaveBeenCalledTimes(1); expect(onRetry).not.toHaveBeenCalled()
  })
  it('does not reset the total deadline after a slow attempt', async () => {
    const fn = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 900)); throw new RequestFailure('Busy', 502, true) })
    const promise = retryRead(fn, { ...options(), timeoutMs: 1000 }).catch(error => error)
    await vi.advanceTimersByTimeAsync(1000); await promise; expect(fn).toHaveBeenCalledTimes(1)
  })
  it('ignores reporting failures but preserves the request result', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValue('ok')
    const promise = retryRead(fn, { ...options(), onRetry: () => { throw new Error('UI failed') } })
    await vi.advanceTimersByTimeAsync(500); await expect(promise).resolves.toBe('ok')
  })
  it('parses delay seconds and HTTP dates, rejecting misleading numeric values', () => {
    const now = Date.parse('Tue, 29 Sep 2026 21:00:00 GMT')
    expect(parseRetryAfter('3', now)).toBe(3000)
    expect(parseRetryAfter('Tue, 29 Sep 2026 21:00:02 GMT', now)).toBe(2000)
    for (const value of ['-1', '1.5', 'garbage', 'Infinity']) expect(parseRetryAfter(value, now)).toBe(0)
  })
  it('reduces provider errors to metadata, never raw source or credentials', () => {
    const error = Object.assign(new Error('PRIVATE_SOURCE sk-secret'), { status: 429, headers: new Headers({ 'retry-after': '3' }) })
    expect(retryHeaders(error)).toEqual({ 'x-lt-retryable': 'true', 'Retry-After': '3' })
    expect(JSON.stringify(failurePolicy(error))).not.toContain('PRIVATE')
    expect(retryHeaders(error, true)['x-lt-retryable']).toBe('false')
  })
})
