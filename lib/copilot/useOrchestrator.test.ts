import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOrchestrator, type ExtractedProblem } from './useOrchestrator'
import { executeTests, type TestRunResult } from './codeExecutor'
vi.mock('./codeExecutor', () => ({
  extractCode: () => ({ code: 'function solve() { return 1 }', language: 'javascript' }),
  extractTests: () => ({ tests: 'assert(solve() === 2)', language: 'javascript' }),
  canExecute: () => true, isRemoteLanguage: () => false, normalizeLanguage: (language: string) => language,
  preloadRuntime: vi.fn(), executeTests: vi.fn(),
}))
const problem: ExtractedProblem = { question: 'Return two', functionName: 'solve', params: '', returnType: 'number', constraints: [], examples: [], edgeCases: [], language: 'javascript', testAsserts: 'assert(solve() === 2)' }
const failed = { total: 1, passed: 0, failed: 1, cases: [{ label: 'returns two', passed: false, error: 'expected 2' }], elapsedMs: 1 } as TestRunResult
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('coding pipeline cancellation', () => {
  it('aborts extraction and ignores a late extraction after reset', async () => {
    let resolve!: (response: Response) => void
    const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() => new Promise<Response>((done) => { resolve = done }))
    vi.stubGlobal('fetch', fetcher)
    const ask = vi.fn().mockResolvedValue('solution')
    const hook = renderHook(() => useOrchestrator(ask))
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.process('frame', null) })
    act(() => hook.result.current.reset())
    await act(async () => { resolve(Response.json(problem)); await pending })
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true)
    expect(ask).not.toHaveBeenCalled()
    expect(hook.result.current.stage).toBe('idle')
    expect(hook.result.current.problem).toBeNull()
  })
  it('does not issue an AI retry when local tests finish after Stop', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(problem)))
    let finishTests!: (result: TestRunResult) => void
    vi.mocked(executeTests).mockImplementation(() => new Promise((resolve) => { finishTests = resolve }))
    const ask = vi.fn().mockResolvedValue('solution with tests')
    const hook = renderHook(() => useOrchestrator(ask))
    let pending!: Promise<void>
    act(() => { pending = hook.result.current.process('frame', null) })
    await waitFor(() => expect(hook.result.current.stage).toBe('executing'))
    act(() => hook.result.current.reset())
    await act(async () => { finishTests(failed); await pending })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(hook.result.current.stage).toBe('idle')
    expect(hook.result.current.testResult).toBeNull()
  })
  it('keeps the new run locked when an older reset run finishes late', async () => {
    const resolves: ((response: Response) => void)[] = []
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => resolves.push(resolve)))
    vi.stubGlobal('fetch', fetcher)
    const ask = vi.fn()
    const hook = renderHook(() => useOrchestrator(ask))
    let first!: Promise<void>; let second!: Promise<void>
    act(() => { first = hook.result.current.process('old', null) })
    act(() => hook.result.current.reset())
    act(() => { second = hook.result.current.process('new', null) })
    await act(async () => { resolves[0](Response.json(problem)); await first })
    await act(async () => { await hook.result.current.process('overlap', null) })
    expect(fetcher).toHaveBeenCalledTimes(2)
    await act(async () => { resolves[1](Response.json({ noProblem: true })); await second })
    expect(ask).not.toHaveBeenCalled()
    expect(hook.result.current.stage).toBe('idle')
  })
  it('does not mark a missing solution as done', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(problem)))
    const hook = renderHook(() => useOrchestrator(vi.fn().mockResolvedValue(undefined)))
    await act(async () => { await hook.result.current.process('frame', null) })
    expect(hook.result.current.stage).toBe('idle')
    expect(hook.result.current.error).toContain('did not complete a solution')
    expect(executeTests).not.toHaveBeenCalled()
  })
})
