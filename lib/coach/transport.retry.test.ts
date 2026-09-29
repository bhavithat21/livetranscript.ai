// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { httpCoachTransport } from './transport'
import { httpCapture, ScreenObserver } from './screen'
import { getRetryStatus } from './retryStatus'
import type { ContextPacket } from './types'
const context = {} as ContextPacket
const observation = { files: [], visiblePaths: [], terminal: '', requirements: [] }
const done = { type: 'done', model: 'fixture-model', guidance: null }
const ndjson = (...events: unknown[]) => new Response(events.map(event => JSON.stringify(event)).join('\n') + '\n', { headers: { 'Content-Type': 'application/x-ndjson' } })
const options = () => ({ signal: new AbortController().signal, delta: vi.fn(), onRetry: vi.fn() })
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(Math, 'random').mockReturnValue(0.5) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('read-only transport retries', () => {
  it('retries a transient screen failure and keeps the exact screenshot and correlation ID', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('gateway unavailable', { status: 502 })).mockResolvedValueOnce(Response.json({ observation, model: 'fixture' }))
    vi.stubGlobal('fetch', fetchMock)
    const promise = httpCapture('data:image/png;base64,AAAA', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(100)
    expect(getRetryStatus()[0]).toMatchObject({ stage: 'screen_model', attempt: 2 })
    await vi.advanceTimersByTimeAsync(400)
    await expect(promise).resolves.toEqual(observation)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0][1].body).toBe(fetchMock.mock.calls[1][1].body)
    expect(fetchMock.mock.calls[1][1].headers['x-lt-attempt']).toBe('2')
    expect(getRetryStatus()).toHaveLength(0)
  })
  it('does not pay for repeated screen-validation failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ error: 'Invalid evidence' }, { status: 502, headers: { 'x-lt-retryable': 'false' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(httpCapture('image', new AbortController().signal)).rejects.toThrow('Invalid evidence')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not retry malformed successful screen responses', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ observation: { files: 'invalid' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(httpCapture('image', new AbortController().signal)).rejects.toBeInstanceOf(Error)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('retains the selected screen and commits one observation after recovery', async () => {
    const received = vi.fn(), stop = vi.fn(), fetchMock = vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(Response.json({ observation }))
    vi.stubGlobal('fetch', fetchMock)
    const screen = new ScreenObserver(received)
    await screen.attach({ signal: async () => null, image: async () => 'data:image/png;base64,AAAA', stop }, 'browser')
    const promise = screen.captureNow()
    await vi.advanceTimersByTimeAsync(500); expect(await promise).toBe(true)
    expect(received).toHaveBeenCalledTimes(1); expect(screen.getSnapshot().sharing).toBe(true)
    expect(stop).not.toHaveBeenCalled(); await screen.stop()
  })
  it('cancels queued screen retries when the selected source is stopped', async () => {
    const received = vi.fn(), fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const screen = new ScreenObserver(received)
    await screen.attach({ signal: async () => null, image: async () => 'data:image/png;base64,AAAA', stop() {} }, 'browser')
    const promise = screen.captureNow()
    await vi.advanceTimersByTimeAsync(100); await screen.stop(); await promise
    await vi.advanceTimersByTimeAsync(2000)
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(received).not.toHaveBeenCalled(); expect(getRetryStatus()).toHaveLength(0)
  })
  it('retries a server-classified transient stream failure before text', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(ndjson({ type: 'started' }, { type: 'error', retryable: true, status: 503 })).mockResolvedValueOnce(ndjson({ type: 'delta', text: 'One answer', model: 'fixture-model' }, done))
    vi.stubGlobal('fetch', fetchMock)
    const settings = options(), promise = httpCoachTransport('talk', context, settings)
    await vi.advanceTimersByTimeAsync(500)
    await expect(promise).resolves.toEqual({ model: 'fixture-model', guidance: null })
    expect(settings.delta).toHaveBeenCalledExactlyOnceWith('One answer', 'fixture-model')
    expect(settings.onRetry).toHaveBeenCalledTimes(1); expect(getRetryStatus()).toHaveLength(0)
  })
  it('never appends a regenerated answer after a partial stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjson({ type: 'delta', text: 'Partial', model: 'fixture-model' }, { type: 'error', retryable: true, status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    const settings = options()
    await expect(httpCoachTransport('talk', context, settings)).rejects.toThrow('Model request failed')
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(settings.delta).toHaveBeenCalledTimes(1)
    expect(settings.onRetry).not.toHaveBeenCalled()
  })
  it('does not retry refusals or schema errors carried in the stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjson({ type: 'error', retryable: false, status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(httpCoachTransport('guide', context, options())).rejects.toThrow('Model request failed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('does not retry an unavailable model configuration returned as HTTP503', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 503, headers: { 'x-lt-retryable': 'false' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(httpCoachTransport('guide', context, options())).rejects.toThrow('503')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('stops stream consumption at done instead of reacting to trailing bytes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ndjson(done, { type: 'error', retryable: true, status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(httpCoachTransport('talk', context, options())).resolves.toMatchObject({ model: 'fixture-model' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
  it('honors controller retry budgets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const beforeRetry = vi.fn(() => false)
    const promise = httpCoachTransport('guide', context, { ...options(), beforeRetry }).catch(error => error)
    await vi.advanceTimersByTimeAsync(500); await promise
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(beforeRetry).toHaveBeenCalledTimes(1)
  })
})
