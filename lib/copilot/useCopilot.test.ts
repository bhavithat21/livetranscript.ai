import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useCopilot } from './useCopilot'
import { captureLatency } from './latency'
vi.mock('./latency', () => ({ captureLatency: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('copilot stream ownership', () => {
  it('ignores a superseded response even if its fetch ignores abort', async () => {
    const resolves: ((response: Response) => void)[] = []
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => resolves.push(resolve)))
    vi.stubGlobal('fetch', fetcher)
    const hook = renderHook(() => useCopilot(() => 'Source evidence', { format: 'keywords', tone: 'technical', followups: true }))
    let first!: Promise<string | undefined>; let second!: Promise<string | undefined>
    act(() => { first = hook.result.current.ask('Old question?') })
    act(() => { second = hook.result.current.ask('New question?') })
    await act(async () => { resolves[1](new Response('New answer')); expect(await second).toBe('New answer') })
    await act(async () => { resolves[0](new Response('Stale answer')); expect(await first).toBeUndefined() })
    expect(hook.result.current.turns.filter((turn) => turn.role === 'assistant').map((turn) => turn.content)).toEqual(['New answer'])
    expect(hook.result.current.streaming).toBe(false)
    expect(captureLatency).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetcher.mock.calls[1] as unknown as [string, RequestInit])[1].body))
    expect(body.preferences).toEqual({ format: 'keywords', tone: 'technical', followups: true })
    expect(body.transcript).toBe('Source evidence')
  })
  it('stops a pending read immediately and preserves the partial answer', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('Partial')) }, cancel })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const hook = renderHook(() => useCopilot(() => ''))
    let pending!: Promise<string | undefined>
    act(() => { pending = hook.result.current.ask('Question?') })
    await waitFor(() => expect(hook.result.current.turns.at(-1)?.content).toBe('Partial'))
    await act(async () => { hook.result.current.stop(); expect(await pending).toBeUndefined() })
    expect(hook.result.current.streaming).toBe(false)
    expect(hook.result.current.turns.at(-1)?.content).toBe('Partial')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(captureLatency).not.toHaveBeenCalled()
  })
  it('does not return a failed partial stream as completed code', async () => {
    let fail!: () => void
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('Incomplete solution'))
      fail = () => controller.error(new Error('Connection interrupted'))
    } })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    const hook = renderHook(() => useCopilot(() => ''))
    let pending!: Promise<string | undefined>
    act(() => { pending = hook.result.current.ask('Solve?', 'coding') })
    await waitFor(() => expect(hook.result.current.turns.at(-1)?.content).toBe('Incomplete solution'))
    await act(async () => { fail(); expect(await pending).toBeUndefined() })
    expect(hook.result.current.error).toBe('Connection interrupted')
    expect(hook.result.current.streaming).toBe(false)
    expect(captureLatency).not.toHaveBeenCalled()
  })
  it('cancels open streams on unmount', async () => {
    const cancel = vi.fn()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new ReadableStream({ start() {}, cancel }))))
    const hook = renderHook(() => useCopilot(() => ''))
    let pending!: Promise<string | undefined>
    await act(async () => { pending = hook.result.current.ask('Question?'); await Promise.resolve() })
    hook.unmount()
    expect(await pending).toBeUndefined()
    expect(cancel).toHaveBeenCalledTimes(1)
  })
})
