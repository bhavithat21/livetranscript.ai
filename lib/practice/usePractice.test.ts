import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePractice } from './usePractice'
import { deliveryMetrics, practiceReportText } from './metrics'

const settings = { role: 'Staff engineer', kind: 'behavioral' as const, context: 'Private resume context' }
const answer = 'I planned the rollback and tested it in staging.'
const feedback = { summary: 'A concrete preparation step.', rubric: [
  { criterion: 'Specificity', score: 4, evidence: 'tested it in staging', suggestion: 'Explain the success criteria.' },
  { criterion: 'Outcome', score: null, evidence: '', suggestion: 'Add the result.' },
], strength: 'You named a rollback check.', nextStep: 'Explain the result.' }
const first = { model: 'coach-model', question: 'Tell me about a migration.', focus: 'Ownership' }
const second = { model: 'coach-model', question: 'What did that test reveal?', focus: 'Outcomes', feedback }

beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('practice lifecycle', () => {
  it('keeps failed answers retryable, commits each answer once and exports an evidence-based review', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(first))
    const { result } = renderHook(() => usePractice())
    await act(async () => { expect(await result.current.start(settings)).toBe(true) })
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'Provider unavailable' }, { status: 502 }))
    await act(async () => { expect(await result.current.submit(answer, deliveryMetrics(answer, 0, 'typed'))).toBe(false) })
    expect(result.current.session?.turns).toHaveLength(0)
    expect(result.current.session?.phase).toBe('answering')
    expect(result.current.error).toBe('Provider unavailable')
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(second))
    await act(async () => { expect(await result.current.submit(answer, deliveryMetrics(answer, 0, 'typed'))).toBe(true) })
    expect(result.current.session?.turns).toHaveLength(1)
    expect(result.current.session?.phase).toBe('feedback')
    await act(async () => { expect(await result.current.submit(answer, deliveryMetrics(answer, 0, 'typed'))).toBe(false) })
    expect(fetch).toHaveBeenCalledTimes(3)
    const report = { summary: 'Outcome detail is the next focus.', highlights: [{ turn: 1, quote: 'tested it in staging', observation: 'Specific evidence of preparation.' }], practiceNext: ['Rehearse the outcome in one sentence.'] }
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ model: 'coach-model', report }))
    await act(async () => { expect(await result.current.finish()).toBe(true) })
    const exported = practiceReportText(result.current.session!)
    expect(exported).toContain(answer)
    expect(exported).toContain('4/5 (AI estimate)')
    expect(exported).toContain('Outcome detail is the next focus.')
    expect(exported).not.toContain('Private resume context')
    expect(result.current.session?.phase).toBe('report')
  })
  it('cancels an in-flight request, ignores a late response and permits a clean retry', async () => {
    let resolve: (response: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValueOnce(new Promise<Response>((done) => { resolve = done }))
    const { result } = renderHook(() => usePractice())
    let running: Promise<boolean> = Promise.resolve(false)
    act(() => { running = result.current.start(settings) })
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
    act(() => result.current.cancel())
    expect(signal?.aborted).toBe(true)
    await act(async () => { resolve(Response.json(first)); expect(await running).toBe(false) })
    expect(result.current.session).toBeNull()
    vi.mocked(fetch).mockResolvedValueOnce(Response.json(first))
    await act(async () => { expect(await result.current.start(settings)).toBe(true) })
    expect(result.current.session?.question).toBe(first.question)
  })
  it('rejects overlapping calls and aborts network work when the route unmounts', async () => {
    let resolve: (response: Response) => void = () => {}
    vi.mocked(fetch).mockReturnValue(new Promise<Response>((done) => { resolve = done }))
    const { result, unmount } = renderHook(() => usePractice())
    let running: Promise<boolean> = Promise.resolve(false)
    act(() => { running = result.current.start(settings) })
    await act(async () => { expect(await result.current.start(settings)).toBe(false) })
    expect(fetch).toHaveBeenCalledTimes(1)
    const signal = vi.mocked(fetch).mock.calls[0][1]?.signal
    unmount()
    expect(signal?.aborted).toBe(true)
    resolve(Response.json(first))
    expect(await running).toBe(false)
  })
  it('bounds waiting and leaves no request timer after cancellation', async () => {
    vi.useFakeTimers()
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const { result } = renderHook(() => usePractice())
    let running: Promise<boolean> = Promise.resolve(false)
    act(() => { running = result.current.start(settings) })
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); expect(await running).toBe(false) })
    expect(result.current.busy).toBeNull()
    expect(result.current.error).toContain('took too long')
    expect(vi.getTimerCount()).toBe(0)
  })
})
