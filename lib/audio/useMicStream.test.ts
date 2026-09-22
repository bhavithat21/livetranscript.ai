import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMicStream } from './useMicStream'

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done }); return { promise, resolve } }
class Track extends EventTarget {
  readyState = 'live'
  stop = vi.fn(() => { this.readyState = 'ended' })
  end() { this.readyState = 'ended'; this.dispatchEvent(new Event('ended')) }
}
function stream(audio = [new Track()], video: Track[] = []) {
  return { getAudioTracks: () => audio, getVideoTracks: () => video, getTracks: () => [...audio, ...video] } as unknown as MediaStream
}
const getUserMedia = vi.fn()
const getDisplayMedia = vi.fn()
const addModule = vi.fn()
const contexts: Context[] = []
class Context {
  state = 'running'
  sampleRate = 16_000
  destination = {}
  audioWorklet = { addModule }
  close = vi.fn(async () => { this.state = 'closed' })
  resume = vi.fn(async () => { this.state = 'running' })
  createMediaStreamSource = vi.fn(() => ({ connect: vi.fn(), disconnect: vi.fn() }))
  createGain = vi.fn(() => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }))
  constructor() { contexts.push(this) }
}
class Processor {
  port = { onmessage: null, close: vi.fn() }
  connect = vi.fn()
  disconnect = vi.fn()
}
beforeEach(() => {
  vi.clearAllMocks()
  contexts.length = 0
  addModule.mockResolvedValue(undefined)
  getUserMedia.mockResolvedValue(stream())
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia, getDisplayMedia } })
  vi.stubGlobal('AudioContext', Context)
  vi.stubGlobal('AudioWorkletNode', Processor)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('browser audio ownership', () => {
  it('closes a permission grant that arrives after Stop without opening an audio graph', async () => {
    const permission = deferred<MediaStream>()
    const track = new Track()
    getUserMedia.mockReturnValue(permission.promise)
    const { result } = renderHook(() => useMicStream())
    let starting!: Promise<unknown>
    act(() => { starting = result.current.start(vi.fn(), vi.fn()).catch((cause) => cause) })
    act(() => result.current.stop())
    await act(async () => { permission.resolve(stream([track])); await starting })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(contexts).toHaveLength(0)
    expect(result.current.error).toBeNull()
  })

  it('cleans tracks and context when worklet initialization fails', async () => {
    const track = new Track()
    getUserMedia.mockResolvedValue(stream([track]))
    addModule.mockRejectedValue(new Error('Worklet unavailable'))
    const { result } = renderHook(() => useMicStream())
    await act(async () => { await expect(result.current.start(vi.fn(), vi.fn())).rejects.toThrow('Worklet unavailable') })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(contexts[0].close).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBe('Worklet unavailable')
  })

  it('ends capture when the shared audio track ends, once, without treating local Stop as an external end', async () => {
    const audio = new Track()
    const video = new Track()
    getDisplayMedia.mockResolvedValue(stream([audio], [video]))
    const ended = vi.fn()
    const { result } = renderHook(() => useMicStream())
    await act(async () => result.current.start(vi.fn(), vi.fn(), { source: 'system', onEnded: ended }))
    expect(video.stop).toHaveBeenCalledTimes(1)
    act(() => { audio.end(); result.current.stop() })
    expect(ended).toHaveBeenCalledTimes(1)
    expect(contexts[0].close).toHaveBeenCalledTimes(1)
  })

  it('cleans video tracks when a display is shared without audio', async () => {
    const video = new Track()
    getDisplayMedia.mockResolvedValue(stream([], [video]))
    const { result } = renderHook(() => useMicStream())
    await act(async () => { await expect(result.current.start(vi.fn(), vi.fn(), { source: 'system' })).rejects.toThrow('No system audio shared') })
    expect(video.stop).toHaveBeenCalled()
    expect(contexts).toHaveLength(0)
  })

  it('does not let a stale worklet completion close a replacement stream', async () => {
    const oldWorklet = deferred<void>()
    addModule.mockReturnValueOnce(oldWorklet.promise)
    const oldTrack = new Track()
    const newTrack = new Track()
    getUserMedia.mockResolvedValueOnce(stream([oldTrack])).mockResolvedValueOnce(stream([newTrack]))
    const { result } = renderHook(() => useMicStream())
    let oldStart!: Promise<unknown>
    await act(async () => { oldStart = result.current.start(vi.fn(), vi.fn()).catch((cause) => cause); await Promise.resolve() })
    act(() => result.current.stop())
    await act(async () => result.current.start(vi.fn(), vi.fn()))
    await act(async () => { oldWorklet.resolve(); await oldStart })
    expect(oldTrack.stop).toHaveBeenCalledTimes(1)
    expect(newTrack.stop).not.toHaveBeenCalled()
    expect(contexts[1].close).not.toHaveBeenCalled()
  })

  it('retires a late microphone grant after unmount', async () => {
    const permission = deferred<MediaStream>()
    const track = new Track()
    getUserMedia.mockReturnValue(permission.promise)
    const { result, unmount } = renderHook(() => useMicStream())
    let starting!: Promise<unknown>
    act(() => { starting = result.current.start(vi.fn(), vi.fn()).catch((cause) => cause) })
    unmount()
    await act(async () => { permission.resolve(stream([track])); await starting })
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
