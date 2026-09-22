import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useScreenRepository } from './useScreenRepository'

const observation = {
  files: [{ path: 'src/orders.ts', language: 'typescript', startLine: 1, lines: ['export function cancel() { return true }'], confidence: 0.95, endOfFile: true }],
  visiblePaths: ['src/orders.ts'], terminal: '', requirements: [],
}
const image = 'data:image/jpeg;base64,fixture'
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('screenshot session lifecycle', () => {
  it('passes selected output preferences to final repository synthesis', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('{"type":"delta","text":"Grounded answer"}\n{"type":"done"}\n'))
    vi.stubGlobal('fetch', fetcher)
    const preferences = { format: 'keywords' as const, tone: 'technical' as const, followups: true }
    const hook = renderHook(() => useScreenRepository(true, false, () => null, preferences))
    await act(async () => { expect(await hook.result.current.analyze('Where do I navigate?', 'src/source.ts:12', '')).toBe(true) })
    expect(JSON.parse(fetcher.mock.calls[0][1].body).preferences).toEqual(preferences)
  })
  it('retains previous evidence when extraction fails and permits retry of the same image', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ observation, model: 'vision-test' }))
      .mockResolvedValueOnce(Response.json({ error: 'Read failed' }, { status: 502 }))
      .mockResolvedValueOnce(Response.json({ observation, model: 'vision-test' }))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useScreenRepository(true, true, () => image))
    await act(async () => { await result.current.capture() })
    expect(result.current.snapshot.captures).toBe(1)
    await act(async () => { await result.current.captureImage(image + 'new') })
    expect(result.current.snapshot.captures).toBe(1)
    expect(result.current.captureError).toBe('Read failed')
    await act(async () => { await result.current.captureImage(image + 'new') })
    expect(result.current.snapshot.captures).toBe(2)
    expect(result.current.captureError).toBeNull()
  })

  it('clear cancels a late capture without resurrecting old evidence', async () => {
    let resolve!: (response: Response) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((done) => { resolve = done })))
    const { result } = renderHook(() => useScreenRepository(true, true, () => image))
    let pending!: Promise<void>
    act(() => { pending = result.current.capture() })
    act(() => result.current.reset())
    await act(async () => { resolve(Response.json({ observation, model: 'vision-test' })); await pending })
    expect(result.current.snapshot.files).toEqual([])
    expect(result.current.capturing).toBe(false)
  })

  it('requires stream completion and preserves model failures instead of marking success', async () => {
    const events = [
      { type: 'agent', role: 'reviewer', model: 'review-test', status: 'failed', text: 'Unavailable' },
      { type: 'delta', text: 'Partial answer' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(events)))
    const { result } = renderHook(() => useScreenRepository(true, false, () => null))
    let ok = true
    await act(async () => { ok = await result.current.analyze('What is wrong?', 'observed code', '', 'debug') })
    expect(ok).toBe(false)
    expect(result.current.analysis?.answer).toBe('Partial answer')
    expect(result.current.analysis?.agents[0].status).toBe('failed')
    expect(result.current.analysis?.error).toMatch(/before completion/)
  })

  it('parses split NDJSON chunks and holds a synchronous lock against overlapping analysis', async () => {
    let finish!: () => void
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode('{"type":"del'))
      finish = () => {
        controller.enqueue(encoder.encode('ta","text":"Grounded answer"}\n{"type":"done"}\n'))
        controller.close()
      }
    } })
    const fetcher = vi.fn().mockResolvedValue(new Response(body))
    vi.stubGlobal('fetch', fetcher)
    const { result } = renderHook(() => useScreenRepository(true, false, () => null))
    let first!: Promise<boolean>
    act(() => { first = result.current.analyze('Question one?', 'evidence', '') })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await act(async () => { expect(await result.current.analyze('Question two?', 'evidence', '')).toBe(false) })
    await act(async () => { finish(); expect(await first).toBe(true) })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(result.current.analysis?.answer).toBe('Grounded answer')
    expect(result.current.analysis?.running).toBe(false)
  })

  it('keeps earlier answers selectable while later questions finish', async () => {
    const response = (text: string) => new Response(`${JSON.stringify({ type: 'delta', text })}\n{"type":"done"}\n`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('First answer')).mockResolvedValueOnce(response('Second answer')))
    const { result } = renderHook(() => useScreenRepository(true, false, () => null))
    await act(async () => { await result.current.analyze('First question?', 'evidence', '') })
    act(() => result.current.showQuestion('First question?'))
    await act(async () => { await result.current.analyze('Second question?', 'evidence', '') })
    expect(result.current.history).toHaveLength(2)
    expect(result.current.analysis?.answer).toBe('Second answer')
    expect(result.current.displayAnalysis?.answer).toBe('First answer')
    act(() => result.current.setDisplayId(null))
    expect(result.current.displayAnalysis?.answer).toBe('Second answer')
  })

  it('selects repeated question history by ledger identity rather than wording', async () => {
    const response = (text: string) => new Response(`${JSON.stringify({ type: 'delta', text })}\n{"type":"done"}\n`)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response('First occurrence')).mockResolvedValueOnce(response('Second occurrence')))
    const { result } = renderHook(() => useScreenRepository(true, false, () => null))
    await act(async () => { await result.current.analyze('How does cancellation work?', 'first evidence', '', 'plan', 'ledger-first') })
    await act(async () => { await result.current.analyze('How does cancellation work?', 'second evidence', '', 'plan', 'ledger-second') })
    act(() => result.current.showQuestion('How does cancellation work?', 'ledger-first'))
    expect(result.current.displayAnalysis?.answer).toBe('First occurrence')
    expect(result.current.displayAnalysis?.questionId).toBe('ledger-first')
  })
})

it('does not mark an empty completed response answered', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"type":"done"}\n')))
  const { result } = renderHook(() => useScreenRepository(true, false, () => null))
  await act(async () => {
    expect(await result.current.analyze('What should change?', 'source', '')).toBe(false)
  })
  expect(result.current.analysis?.error).toContain('no answer')
  expect(result.current.history[0].error).toContain('no answer')
})

it('finishes on the completion event and cancels a connection that remains open', async () => {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Verified guidance"}\n{"type":"done"}\n')) },
    cancel,
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
  const { result } = renderHook(() => useScreenRepository(true, false, () => null))
  await act(async () => { expect(await result.current.analyze('Question?', 'source', '')).toBe(true) })
  expect(result.current.analysis?.running).toBe(false)
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('stopping an analysis closes a pending stream read and releases the request lock', async () => {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({ start() {}, cancel })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
  const { result } = renderHook(() => useScreenRepository(true, false, () => null))
  let request!: Promise<boolean>
  await act(async () => { request = result.current.analyze('Question?', 'source', ''); await Promise.resolve() })
  await act(async () => { result.current.stopAnalysis(); expect(await request).toBe(false) })
  expect(result.current.analysis?.running).toBe(false)
  expect(result.current.analysis?.error).toContain('stopped or timed out')
  expect(cancel).toHaveBeenCalledTimes(1)
})

it('rejects malformed specialist notes before passing them to the rendered answer', async () => {
  const event = { type: 'agent', role: 'reviewer', status: 'done', text: { unsafe: 'not text' } }
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(event) + '\n')))
  const { result } = renderHook(() => useScreenRepository(true, false, () => null))
  await act(async () => { expect(await result.current.analyze('Question?', 'source', '')).toBe(false) })
  expect(result.current.analysis?.agents).toEqual([])
  expect(result.current.analysis?.error).toContain('Invalid specialist response')
})

it('bounds unterminated stream events and cancels them instead of accumulating indefinitely', async () => {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(128_001))) },
    cancel,
  })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
  const { result } = renderHook(() => useScreenRepository(true, false, () => null))
  await act(async () => { expect(await result.current.analyze('Question?', 'source', '')).toBe(false) })
  expect(result.current.analysis?.error).toContain('oversized event')
  expect(cancel).toHaveBeenCalledTimes(1)
})
