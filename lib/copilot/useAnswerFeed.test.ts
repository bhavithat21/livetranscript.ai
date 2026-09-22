import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnswerFeed } from './useAnswerFeed'
import { captureLatency } from './latency'
import type { AnswerPreferences } from './answerPreferences'
vi.mock('./latency', () => ({ captureLatency: vi.fn() }))
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('answer feed cancellation and retries', () => {
  it('clears a retry delay without issuing a later paid request', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockResolvedValue(new Response('Unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useAnswerFeed())
    let pending!: Promise<void>
    await act(async () => { pending = hook.result.current.answer('Question?', 'general', null, null); await Promise.resolve() })
    expect(hook.result.current.current?.retrying).toBe(true)
    await act(async () => { hook.result.current.clear(); await pending; await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(hook.result.current.entries).toEqual([])
    expect(hook.result.current.cursor).toBe(0)
  })
  it('cancels a pending stream on unmount', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {}, cancel }))))
    const hook = renderHook(() => useAnswerFeed())
    let pending!: Promise<void>
    await act(async () => { pending = hook.result.current.answer('Question?', 'general', null, null); await Promise.resolve() })
    hook.unmount()
    await pending
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(captureLatency).not.toHaveBeenCalled()
  })
  it('replaces the old stream when manually retrying the same card', async () => {
    const cancel = vi.fn()
    const first = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('Partial old answer')) }, cancel })
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(first)).mockResolvedValueOnce(new Response('Fresh answer'))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useAnswerFeed())
    let old!: Promise<void>
    act(() => { old = hook.result.current.answer('Question?', 'general', null, null) })
    await waitFor(() => expect(hook.result.current.current?.answer).toBe('Partial old answer'))
    await act(async () => { hook.result.current.retry(hook.result.current.current!.id); await old })
    await waitFor(() => expect(hook.result.current.current?.streaming).toBe(false))
    expect(hook.result.current.current).toMatchObject({ answer: 'Fresh answer', failed: false })
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(captureLatency).toHaveBeenCalledTimes(1)
  })
  it('retains request-time preferences through retries and reports empty responses as failed', async () => {
    vi.useFakeTimers()
    const fetcher = vi.fn().mockImplementation(async () => new Response(''))
    vi.stubGlobal('fetch', fetcher)
    const initial: AnswerPreferences = { format: 'keywords', tone: 'technical', followups: true }
    const hook = renderHook(({ preferences }) => useAnswerFeed(preferences), { initialProps: { preferences: initial } })
    let pending!: Promise<void>
    await act(async () => { pending = hook.result.current.answer('Question?', 'coding', 'Evidence', null, 'Instructions', 'Transcript'); await Promise.resolve() })
    hook.rerender({ preferences: { format: 'detailed', tone: 'strategic', followups: false } })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await pending })
    expect(fetcher).toHaveBeenCalledTimes(3)
    for (const call of fetcher.mock.calls) expect(JSON.parse(String(call[1].body)).preferences).toEqual(initial)
    expect(hook.result.current.current).toMatchObject({ failed: true, streaming: false, retrying: false, error: 'The assistant returned no answer. Please retry.' })
    expect(captureLatency).not.toHaveBeenCalled()
  })
  it('does not retry authentication failures', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useAnswerFeed())
    await act(async () => { await hook.result.current.answer('Question?', 'general', null, null) })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(hook.result.current.current).toMatchObject({ failed: true, error: 'Sign in to use the assistant' })
  })
})
