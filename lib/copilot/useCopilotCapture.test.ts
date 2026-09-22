import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MicStreamOptions } from '@/lib/audio/useMicStream'
import type { TranscriptEvent } from '@/lib/transcription/types'

const mocks = vi.hoisted(() => ({ browserStart: vi.fn(), browserStop: vi.fn(), nativeStart: vi.fn(), nativeStop: vi.fn(), connect: vi.fn() }))
vi.mock('@/lib/audio/useMicStream', () => ({ useMicStream: () => ({ start: mocks.browserStart, stop: mocks.browserStop }) }))
vi.mock('@/lib/audio/useNativeCapture', () => ({ useNativeCapture: () => ({ start: mocks.nativeStart, stop: mocks.nativeStop }) }))
vi.mock('@/lib/transcription', () => ({ connectWithFallback: mocks.connect }))
vi.mock('@/lib/transcription/useKeytermPrefs', () => ({ useKeytermPrefs: () => ({ keyterms: ['PostgreSQL'] }) }))
import { useCopilotCapture } from './useCopilotCapture'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
function provider() {
  let partial: (event: TranscriptEvent) => void = () => {}
  let final: (event: TranscriptEvent) => void = () => {}
  let status: (event: { error: string }) => void = () => {}
  return {
    sendAudio: vi.fn(), disconnect: vi.fn().mockResolvedValue(undefined), updateKeyterms: vi.fn(),
    onPartial: vi.fn((callback) => { partial = callback }), onFinal: vi.fn((callback) => { final = callback }), onStatus: vi.fn((callback) => { status = callback }),
    partial: (text: string) => partial({ text, isFinal: false, speaker: null, startMs: 0, endMs: 100 }),
    final: (text: string) => final({ text, isFinal: true, speaker: null, startMs: 0, endMs: 100 }),
    fail: () => status({ error: 'Transcription connection lost' }),
  }
}
let asr: ReturnType<typeof provider>
beforeEach(() => {
  vi.resetAllMocks()
  asr = provider()
  mocks.browserStart.mockResolvedValue(16_000)
  mocks.nativeStart.mockResolvedValue(0)
  mocks.nativeStop.mockResolvedValue(undefined)
  mocks.connect.mockResolvedValue({ name: 'Test ASR', provider: asr })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('standalone copilot capture', () => {
  it('does nothing until explicitly started and keeps its transcript getter stable', () => {
    const { result, rerender } = renderHook(() => useCopilotCapture())
    const getter = result.current.getTranscript
    rerender()
    expect(result.current.getTranscript).toBe(getter)
    expect(result.current.status).toBe('idle')
    expect(mocks.browserStart).not.toHaveBeenCalled()
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('deduplicates Start and cancels a pending permission request without connecting ASR', async () => {
    const permission = deferred<number>()
    mocks.browserStart.mockReturnValue(permission.promise)
    const { result } = renderHook(() => useCopilotCapture())
    let starting!: Promise<void>
    act(() => { starting = result.current.start('mic'); void result.current.start('mic') })
    expect(mocks.browserStart).toHaveBeenCalledTimes(1)
    act(() => result.current.stop())
    expect(result.current.status).toBe('idle')
    expect(mocks.browserStop).toHaveBeenCalledTimes(1)
    await act(async () => { permission.resolve(16_000); await starting })
    expect(mocks.connect).not.toHaveBeenCalled()
  })

  it('aborts a pending ASR connection and retires its late result without stopping a replacement', async () => {
    const oldConnection = deferred<{ name: string; provider: ReturnType<typeof provider> }>()
    const oldProvider = provider()
    mocks.connect.mockReturnValueOnce(oldConnection.promise)
    const { result } = renderHook(() => useCopilotCapture())
    let starting!: Promise<void>
    await act(async () => { starting = result.current.start('mic'); await Promise.resolve() })
    const signal = mocks.connect.mock.calls[0][0].signal as AbortSignal
    act(() => result.current.stop())
    expect(signal.aborted).toBe(true)
    await act(async () => result.current.start('mic'))
    const stopCalls = mocks.browserStop.mock.calls.length
    await act(async () => { oldConnection.resolve({ name: 'Old', provider: oldProvider }); await starting })
    expect(oldProvider.disconnect).toHaveBeenCalledTimes(1)
    expect(oldProvider.onFinal).not.toHaveBeenCalled()
    expect(mocks.browserStop).toHaveBeenCalledTimes(stopCalls)
    expect(result.current.status).toBe('listening')
  })

  it('buffers a bounded amount of audio, uses the actual sample rate and preserves finalized context on Stop', async () => {
    mocks.browserStart.mockImplementation(async (send: (pcm: ArrayBuffer) => void) => {
      for (let index = 0; index < 75; index++) send(new ArrayBuffer(4))
      return 48_000
    })
    const { result } = renderHook(() => useCopilotCapture())
    await act(async () => result.current.start('mic'))
    expect(mocks.connect.mock.calls[0][0]).toMatchObject({ sampleRate: 48_000, maxSpeakers: 1, keyterms: ['PostgreSQL'] })
    expect(asr.sendAudio).toHaveBeenCalledTimes(60)
    act(() => { asr.final('How does cancellation work?'); result.current.clear() })
    expect(result.current.getTranscript()).toBe('How does cancellation work?')
    act(() => result.current.stop())
    act(() => asr.final('Late stale words'))
    expect(result.current.transcript).toBe('How does cancellation work?')
    expect(asr.disconnect).toHaveBeenCalledTimes(1)
    act(() => result.current.clear())
    expect(result.current.transcript).toBe('')
  })

  it('falls back from native capture to an explicit browser picker and stops when sharing ends', async () => {
    mocks.nativeStart.mockRejectedValue(new Error('Native capture unavailable'))
    const { result } = renderHook(() => useCopilotCapture())
    await act(async () => result.current.start('system'))
    expect(mocks.browserStart.mock.calls[0][2].source).toBe('system')
    expect(mocks.connect.mock.calls[0][0].maxSpeakers).toBe(5)
    const options = mocks.browserStart.mock.calls[0][2] as MicStreamOptions
    act(() => options.onEnded?.())
    expect(result.current.status).toBe('idle')
    expect(asr.disconnect).toHaveBeenCalledTimes(1)
  })

  it('shows capture and connection failures instead of a listening state', async () => {
    mocks.browserStart.mockRejectedValueOnce(new Error('Microphone permission denied'))
    const { result } = renderHook(() => useCopilotCapture())
    await act(async () => result.current.start('mic'))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Microphone permission denied')
    expect(mocks.connect).not.toHaveBeenCalled()
    await act(async () => result.current.start('mic'))
    act(() => asr.fail())
    expect(result.current.status).toBe('error')
    expect(result.current.error).toBe('Transcription connection lost')
    expect(mocks.browserStop).toHaveBeenCalled()
  })

  it('times out a stalled connection, aborts it and drops late output', async () => {
    vi.useFakeTimers()
    const connection = deferred<{ name: string; provider: ReturnType<typeof provider> }>()
    mocks.connect.mockReturnValue(connection.promise)
    const { result } = renderHook(() => useCopilotCapture())
    let starting!: Promise<void>
    await act(async () => { starting = result.current.start('mic'); await Promise.resolve() })
    act(() => vi.advanceTimersByTime(25_000))
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('connect in time')
    expect(mocks.connect.mock.calls[0][0].signal.aborted).toBe(true)
    await act(async () => { connection.resolve({ name: 'Late', provider: asr }); await starting })
    expect(asr.disconnect).toHaveBeenCalledTimes(1)
  })

  it('bounds context history and reports when earlier text was discarded', async () => {
    const { result } = renderHook(() => useCopilotCapture())
    await act(async () => result.current.start('mic'))
    act(() => { for (let index = 0; index < 605; index++) asr.final(`Question ${index}`) })
    expect(result.current.segments).toHaveLength(600)
    expect(result.current.segments[0].text).toBe('Question 5')
    expect(result.current.truncated).toBe(true)
    act(() => { result.current.stop(); result.current.clear() })
    expect(result.current.truncated).toBe(false)
  })

  it('stops all owned resources on page exit and unmount', async () => {
    const { result, unmount } = renderHook(() => useCopilotCapture())
    await act(async () => result.current.start('system'))
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(result.current.status).toBe('idle')
    expect(mocks.nativeStop).toHaveBeenCalled()
    expect(asr.disconnect).toHaveBeenCalledTimes(1)
    unmount()
    expect(asr.disconnect).toHaveBeenCalledTimes(1)
  })
})
