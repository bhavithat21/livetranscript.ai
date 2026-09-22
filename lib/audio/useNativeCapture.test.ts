import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), channels: [] as { onmessage: (message: unknown) => void }[] }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: class { onmessage = () => {}; constructor() { mocks.channels.push(this) } } }))
import { useNativeCapture } from './useNativeCapture'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.channels.length = 0
  Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} })
  mocks.invoke.mockImplementation(async (command: string) => command === 'start_native_audio' ? 48_000 : undefined)
})
afterEach(async () => { cleanup(); await act(async () => { await Promise.resolve() }); Reflect.deleteProperty(window, '__TAURI_INTERNALS__') })

describe('native audio ownership', () => {
  it('returns zero without loading native capture in a browser', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')
    const { result } = renderHook(() => useNativeCapture())
    expect(await result.current.start(vi.fn(), vi.fn())).toBe(0)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('stops a late permission grant before starting a replacement and ignores its frames', async () => {
    const permission = deferred<number>()
    let starts = 0
    mocks.invoke.mockImplementation((command: string) => {
      if (command !== 'start_native_audio') return Promise.resolve()
      return ++starts === 1 ? permission.promise : Promise.resolve(48_000)
    })
    const { result } = renderHook(() => useNativeCapture())
    const oldFrames = vi.fn()
    const newFrames = vi.fn()
    let original!: Promise<unknown>
    await act(async () => { original = result.current.start(oldFrames, vi.fn()).catch((cause) => cause); await Promise.resolve() })
    expect(starts).toBe(1)
    const stop = result.current.stop()
    const replacement = result.current.start(newFrames, vi.fn())
    expect(starts).toBe(1)
    await act(async () => { permission.resolve(48_000); await Promise.all([original, stop, replacement]) })
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(['start_native_audio', 'stop_native_audio', 'start_native_audio'])
    mocks.channels[0].onmessage(new Int16Array([100]).buffer)
    mocks.channels[1].onmessage(new Int16Array([100]).buffer)
    expect(oldFrames).not.toHaveBeenCalled()
    expect(newFrames).toHaveBeenCalledTimes(1)
    await result.current.stop()
  })

  it('deduplicates concurrent starts and retires a failed acquisition before another attempt', async () => {
    mocks.invoke.mockRejectedValueOnce(new Error('Native permission denied'))
    const { result } = renderHook(() => useNativeCapture())
    const first = result.current.start(vi.fn(), vi.fn())
    expect(result.current.start(vi.fn(), vi.fn())).toBe(first)
    await expect(first).rejects.toThrow('Native permission denied')
    await expect(result.current.start(vi.fn(), vi.fn())).resolves.toBe(48_000)
    expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(['start_native_audio', 'stop_native_audio', 'start_native_audio'])
    await result.current.stop()
  })

  it('does not let an old hook cleanup stop a newer hook owner', async () => {
    const first = renderHook(() => useNativeCapture())
    const next = renderHook(() => useNativeCapture())
    await first.result.current.start(vi.fn(), vi.fn())
    await next.result.current.start(vi.fn(), vi.fn())
    first.unmount()
    await act(async () => { await Promise.resolve() })
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'stop_native_audio')).toHaveLength(0)
    await next.result.current.stop()
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'stop_native_audio')).toHaveLength(1)
  })
})
