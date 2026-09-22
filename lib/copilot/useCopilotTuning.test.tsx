// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { CopilotCalibrationContext, type Calibration } from '@/lib/interview/TuningContext'
import { useCopilot } from './useCopilot'
vi.mock('./latency', () => ({ captureLatency: vi.fn() }))
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
function deferredFetch() {
  let resolve: (response: Response) => void = () => {}
  const fetcher = vi.fn((url: string, init: RequestInit) => {
    void url; void init
    return new Promise<Response>((done) => { resolve = done })
  })
  return { fetcher, resolve: (response: Response) => resolve(response) }
}
describe('shared copilot observations', () => {
  it('records measured completed output and a request-time calibration snapshot', async () => {
    const report = vi.fn()
    let settings: Calibration = { instructions: 'First revision', revision: 1, onResult: report }
    const network = deferredFetch()
    vi.stubGlobal('fetch', network.fetcher)
    const wrapper = ({ children }: { children: ReactNode }) => <CopilotCalibrationContext.Provider value={settings}>{children}</CopilotCalibrationContext.Provider>
    const hook = renderHook(() => useCopilot(() => 'Scenario'), { wrapper })
    let pending: Promise<string | undefined> = Promise.resolve(undefined)
    act(() => { pending = hook.result.current.ask('Question?', 'general') })
    settings = { ...settings, instructions: 'Later edit', revision: 2 }
    hook.rerender()
    await act(async () => { network.resolve(new Response('Observed answer')); await pending })
    expect(report).toHaveBeenCalledTimes(1)
    expect(report.mock.calls[0][0]).toMatchObject({ calibration: 'First revision', revision: 1, answer: 'Observed answer', status: 'complete' })
    expect(report.mock.calls[0][0].firstTokenMs).toBeGreaterThanOrEqual(0)
    expect(JSON.parse(String(network.fetcher.mock.calls[0][1].body)).calibration).toBe('First revision')
  })
  it('does not promote an empty response to success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('')))
    const report = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => <CopilotCalibrationContext.Provider value={{ instructions: '', revision: 0, onResult: report }}>{children}</CopilotCalibrationContext.Provider>
    const hook = renderHook(() => useCopilot(() => ''), { wrapper })
    await act(async () => { expect(await hook.result.current.ask('Question?')).toBeUndefined() })
    expect(report.mock.calls[0][0]).toMatchObject({ status: 'error', firstTokenMs: null })
  })
  it('ignores a response that resolves after clear and cancels the request', async () => {
    const network = deferredFetch()
    vi.stubGlobal('fetch', network.fetcher)
    const report = vi.fn()
    const wrapper = ({ children }: { children: ReactNode }) => <CopilotCalibrationContext.Provider value={{ instructions: '', revision: 0, onResult: report }}>{children}</CopilotCalibrationContext.Provider>
    const hook = renderHook(() => useCopilot(() => ''), { wrapper })
    let pending: Promise<string | undefined> = Promise.resolve(undefined)
    act(() => { pending = hook.result.current.ask('Question?') })
    act(() => hook.result.current.clear())
    await act(async () => { network.resolve(new Response('Stale output')); await pending })
    expect(hook.result.current.turns).toEqual([])
    expect(report).not.toHaveBeenCalled()
    expect(network.fetcher.mock.calls[0][1].signal?.aborted).toBe(true)
  })
})
