import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAnswerFeed } from './useAnswerFeed'
import { captureLatency } from './latency'
import type { AnswerPreferences } from './answerPreferences'
import { createElement, type ReactNode } from 'react'
import { CopilotCalibrationContext, type Calibration } from '@/lib/interview/TuningContext'
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

describe('live and Mock feed calibration', () => {
  it('sends and scores the request-time draft calibration instead of a later edit', async () => {
    const report = vi.fn()
    const running = vi.fn()
    let settings: Calibration = { instructions: 'Draft under test', revision: 3, onResult: report, onRunning: running }
    const wrapper = ({ children }: { children: ReactNode }) => createElement(CopilotCalibrationContext.Provider, { value: settings }, children)
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetcher)
    const preferences: AnswerPreferences = { format: 'keywords', tone: 'technical', followups: true }
    const hook = renderHook(() => useAnswerFeed(preferences), { wrapper })
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.answer('What tradeoff?', 'systemDesign', 'Repository evidence', 'data:image/png;base64,test', 'Mode instructions', 'Scenario transcript') })
    expect(running.mock.calls).toEqual([[true]])
    settings = { ...settings, instructions: 'Later edit', revision: 4 }
    hook.rerender()
    await act(async () => { resolve(new Response('Observed answer')); await pending })
    const body = JSON.parse(String(fetcher.mock.calls[0][1].body))
    expect(body).toMatchObject({ calibration: 'Draft under test', instructions: 'Mode instructions', preferences, transcript: 'Scenario transcript' })
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toMatchObject({
      question: 'What tradeoff?', mode: 'systemDesign', answer: 'Observed answer', transcript: 'Scenario transcript',
      instructions: 'Mode instructions', calibration: 'Draft under test', revision: 3, status: 'complete', hasImage: true,
    })
    expect(report.mock.calls[0][0].firstTokenMs).toBeGreaterThanOrEqual(0)
    expect(report.mock.calls[0][0].totalMs).toBeGreaterThanOrEqual(report.mock.calls[0][0].firstTokenMs)
    expect(running.mock.calls).toEqual([[true], [false]])
  })

  it('records one failed observation after retries while keeping calibration locked', async () => {
    vi.useFakeTimers()
    const report = vi.fn()
    const running = vi.fn()
    let settings: Calibration = { instructions: 'Original draft', revision: 7, onResult: report, onRunning: running }
    const wrapper = ({ children }: { children: ReactNode }) => createElement(CopilotCalibrationContext.Provider, { value: settings }, children)
    const fetcher = vi.fn().mockImplementation(async () => new Response(''))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useAnswerFeed(), { wrapper })
    let pending!: Promise<void>
    await act(async () => { pending = hook.result.current.answer('Question?', 'general', null, null, null, 'Scenario'); await Promise.resolve() })
    settings = { ...settings, instructions: 'Changed draft', revision: 8 }
    hook.rerender()
    expect(running.mock.calls).toEqual([[true]])
    expect(report).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); await pending })
    expect(fetcher).toHaveBeenCalledTimes(3)
    for (const [, init] of fetcher.mock.calls) expect(JSON.parse(String(init.body)).calibration).toBe('Original draft')
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toMatchObject({ calibration: 'Original draft', revision: 7, status: 'error', firstTokenMs: null, answer: '', error: 'The assistant returned no answer. Please retry.' })
    expect(running.mock.calls).toEqual([[true], [false]])
  })

  it('records authentication errors and releases the running state without retries', async () => {
    const report = vi.fn()
    const running = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(CopilotCalibrationContext.Provider, {
      value: { instructions: 'Published profile', revision: 2, onResult: report, onRunning: running },
    }, children)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unauthorized', { status: 401 })))
    const hook = renderHook(() => useAnswerFeed(), { wrapper })
    await act(async () => { await hook.result.current.answer('Question?', 'general', null, null) })
    expect(report.mock.calls[0][0]).toMatchObject({ status: 'error', error: 'Sign in to use the assistant', calibration: 'Published profile', revision: 2 })
    expect(running.mock.calls).toEqual([[true], [false]])
  })

  it.each(['stop', 'clear', 'unmount'] as const)('releases running immediately on %s and never scores a late cancelled response', async (action) => {
    const report = vi.fn()
    const running = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(CopilotCalibrationContext.Provider, {
      value: { instructions: 'Draft', revision: 1, onResult: report, onRunning: running },
    }, children)
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(() => new Promise((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useAnswerFeed(), { wrapper })
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.answer('Question?', 'general', null, null) })
    act(() => { if (action === 'unmount') hook.unmount(); else hook.result.current[action]() })
    expect(running.mock.calls).toEqual([[true], [false]])
    expect(fetcher.mock.calls[0][1].signal?.aborted).toBe(true)
    await act(async () => { resolve(new Response('Stale cancelled answer')); await pending })
    expect(report).not.toHaveBeenCalled()
    expect(running.mock.calls).toEqual([[true], [false]])
  })

  it('does not unlock calibration while another feed card is still running', async () => {
    const report = vi.fn()
    const running = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => createElement(CopilotCalibrationContext.Provider, {
      value: { instructions: 'Draft', revision: 1, onResult: report, onRunning: running },
    }, children)
    const resolves: ((response: Response) => void)[] = []
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => resolves.push(resolve))))
    const hook = renderHook(() => useAnswerFeed(), { wrapper })
    let first!: Promise<void>; let second!: Promise<void>
    act(() => { first = hook.result.current.answer('First?', 'general', null, null); second = hook.result.current.answer('Second?', 'general', null, null) })
    await act(async () => { resolves[0](new Response('First answer')); await first })
    expect(running.mock.calls).toEqual([[true]])
    await act(async () => { resolves[1](new Response('Second answer')); await second })
    expect(running.mock.calls).toEqual([[true], [false]])
    expect(report).toHaveBeenCalledTimes(2)
  })
})
