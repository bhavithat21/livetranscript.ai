// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptEvent, TranscriptionProvider } from '@/lib/transcription/types'
const mocks = vi.hoisted(() => ({ audioStart: vi.fn(), audioStop: vi.fn(), nativeStart: vi.fn(), nativeStop: vi.fn(), connect: vi.fn() }))
vi.mock('@/lib/audio/useMicStream', () => ({ useMicStream: () => ({ start: mocks.audioStart, stop: mocks.audioStop }) }))
vi.mock('@/lib/audio/useNativeCapture', () => ({ useNativeCapture: () => ({ start: mocks.nativeStart, stop: mocks.nativeStop }) }))
vi.mock('@/lib/transcription/useKeytermPrefs', () => ({ useKeytermPrefs: () => ({ keyterms: ['queue'] }) }))
vi.mock('@/lib/transcription', () => ({ connectWithFallback: mocks.connect }))
import { useInterviewCapture } from './useInterviewCapture'

function provider() {
  const callbacks: { final?: (event: TranscriptEvent) => void } = {}
  const value: TranscriptionProvider = {
    connect: vi.fn(), sendAudio: vi.fn(), updateKeyterms: vi.fn(),
    onPartial: vi.fn(), onFinal: (callback) => { callbacks.final = callback },
    disconnect: vi.fn().mockResolvedValue(undefined),
  }
  return { value, callbacks }
}
beforeEach(() => {
  mocks.audioStart.mockReset().mockResolvedValue(16000)
  mocks.audioStop.mockReset()
  mocks.nativeStart.mockReset().mockResolvedValue(0)
  mocks.nativeStop.mockReset().mockResolvedValue(undefined)
  mocks.connect.mockReset()
})
afterEach(() => cleanup())
const final: TranscriptEvent = { text: 'I rolled back the failing change.', isFinal: true, speaker: 0, startMs: 0, endMs: 500 }

describe('interview capture lifecycle', () => {
  it.each([['mic', 'candidate'], ['system', 'interviewer']] as const)('attributes %s to %s and deduplicates finals', async (source, role) => {
    const p = provider()
    mocks.connect.mockResolvedValue({ provider: p.value, name: 'Test' })
    const sink = vi.fn()
    const { result } = renderHook(() => useInterviewCapture(sink))
    await act(async () => { await result.current.start(source, Date.now()) })
    act(() => { p.callbacks.final?.(final); p.callbacks.final?.(final) })
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink.mock.calls[0][0].role).toBe(role)
    await act(async () => { await result.current.stop() })
    expect(p.value.disconnect).toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
  it('disconnects a provider that resolves after Stop', async () => {
    const p = provider()
    let resolve!: (result: { provider: TranscriptionProvider; name: string }) => void
    mocks.connect.mockReturnValue(new Promise((done) => { resolve = done }))
    const { result } = renderHook(() => useInterviewCapture(vi.fn()))
    let starting!: Promise<boolean>
    await act(async () => { starting = result.current.start('mic', Date.now()); await Promise.resolve() })
    let stopping!: Promise<void>
    act(() => { stopping = result.current.stop() })
    await act(async () => { resolve({ provider: p.value, name: 'Test' }); await Promise.all([starting, stopping]) })
    expect(p.value.disconnect).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('idle')
  })
  it('stops a native source that resolves after cancellation without connecting transcription', async () => {
    let resolve!: (rate: number) => void
    mocks.nativeStart.mockReturnValue(new Promise((done) => { resolve = done }))
    const { result } = renderHook(() => useInterviewCapture(vi.fn()))
    let starting!: Promise<boolean>
    act(() => { starting = result.current.start('system', Date.now()) })
    let stopping!: Promise<void>
    act(() => { stopping = result.current.stop() })
    await act(async () => { resolve(16000); await Promise.all([starting, stopping]) })
    expect(mocks.nativeStop).toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
  it('surfaces permission errors and releases partially initialized capture', async () => {
    mocks.audioStart.mockRejectedValue(new Error('Permission denied'))
    const { result } = renderHook(() => useInterviewCapture(vi.fn()))
    await act(async () => { expect(await result.current.start('mic', Date.now())).toBe(false) })
    expect(mocks.audioStop).toHaveBeenCalled()
    expect(result.current.error).toContain('permissions')
    expect(result.current.status).toBe('idle')
  })
})
