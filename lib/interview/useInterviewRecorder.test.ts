// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TranscriptEvent } from '@/lib/transcription/types'
const mocks = vi.hoisted(() => ({ browserStart: vi.fn(), browserStop: vi.fn(), nativeStart: vi.fn(), nativeStop: vi.fn(), connect: vi.fn(), send: vi.fn(), disconnect: vi.fn(), partial: vi.fn(), final: vi.fn(), status: vi.fn() }))
vi.mock('@/lib/audio/useMicStream', () => ({ useMicStream: () => ({ start: mocks.browserStart, stop: mocks.browserStop, error: null }) }))
vi.mock('@/lib/audio/useNativeCapture', () => ({ useNativeCapture: () => ({ start: mocks.nativeStart, stop: mocks.nativeStop }) }))
vi.mock('@/lib/transcription', () => ({ connectWithFallback: mocks.connect }))
import { captureText, liveTranscript, useInterviewRecorder } from './useInterviewRecorder'
let emit: (event: TranscriptEvent) => void
const event: TranscriptEvent = { text: 'Final answer', isFinal: true, speaker: 0, startMs: 0, endMs: 100 }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.browserStart.mockResolvedValue(16_000)
  mocks.nativeStart.mockResolvedValue(0)
  mocks.nativeStop.mockResolvedValue(undefined)
  mocks.disconnect.mockResolvedValue(undefined)
  mocks.final.mockImplementation((callback) => { emit = callback })
  mocks.connect.mockResolvedValue({ name: 'Test', provider: { sendAudio: mocks.send, disconnect: mocks.disconnect, onPartial: mocks.partial, onFinal: mocks.final, onStatus: mocks.status } })
})
afterEach(cleanup)
describe('interview capture lifecycle', () => {
  it('passes the actual sample rate and buffers initial audio until ASR connects', async () => {
    const pcm = new ArrayBuffer(4)
    mocks.browserStart.mockImplementation(async (send) => { send(pcm); return 48_000 })
    const { result } = renderHook(() => useInterviewRecorder())
    await act(async () => { await result.current.start('mic') })
    expect(mocks.connect.mock.calls[0][0].sampleRate).toBe(48_000)
    expect(mocks.send).toHaveBeenCalledWith(pcm)
    expect(result.current.phase).toBe('recording')
  })
  it('waits for final words on stop and ignores stale events afterwards', async () => {
    const { result } = renderHook(() => useInterviewRecorder())
    await act(async () => { await result.current.start('mic') })
    mocks.disconnect.mockImplementation(async () => { emit(event) })
    let text = ''
    await act(async () => { text = captureText(await result.current.stop()) })
    expect(text).toBe('Final answer')
    act(() => emit({ ...event, text: 'Late stale words' }))
    expect(captureText(result.current.getSegments())).toBe('Final answer')
    expect(result.current.phase).toBe('idle')
  })
  it('never connects ASR after a pending audio start has been cancelled', async () => {
    let resolve!: (value: number) => void
    mocks.browserStart.mockImplementation(() => new Promise<number>((done) => { resolve = done }))
    const { result } = renderHook(() => useInterviewRecorder())
    await act(async () => {
      const starting = result.current.start('mic').catch(() => undefined)
      const stopping = result.current.stop()
      resolve(16_000)
      await Promise.all([starting, stopping])
    })
    expect(mocks.connect).not.toHaveBeenCalled()
    expect(mocks.browserStop).toHaveBeenCalled()
    expect(result.current.phase).toBe('idle')
  })
  it('disconnects and stops capture when unmounted', async () => {
    const { result, unmount } = renderHook(() => useInterviewRecorder())
    await act(async () => { await result.current.start('mic') })
    await act(async () => { unmount() })
    expect(mocks.browserStop).toHaveBeenCalled()
    expect(mocks.disconnect).toHaveBeenCalled()
    expect(mocks.nativeStop).not.toHaveBeenCalled()
  })
  it('keeps source attribution and flags unfinalized text', () => {
    const row = { id: 1, text: 'Question?', speaker: 0, isFinal: true, capturedAt: 1 }
    const mic = { ...row, text: 'Answer', isFinal: false, capturedAt: 2 }
    expect(liveTranscript([row], [mic])).toBe('Call / speaker 1: Question?\nCandidate microphone: Answer [Unfinalized transcription; verify]')
  })
})

it('returns from Stop while a permission dialog is still pending and ignores its later grant', async () => {
  let resolve!: (rate: number) => void
  mocks.browserStart.mockReturnValue(new Promise<number>((done) => { resolve = done }))
  const { result } = renderHook(() => useInterviewRecorder())
  let starting!: Promise<void>
  act(() => { starting = result.current.start('mic') })
  await act(async () => { await result.current.stop() })
  expect(result.current.phase).toBe('idle')
  expect(mocks.browserStop).toHaveBeenCalledTimes(1)
  expect(mocks.connect).not.toHaveBeenCalled()
  await act(async () => { resolve(16_000); await starting })
  expect(mocks.connect).not.toHaveBeenCalled()
})

it('aborts startup ASR and retires a stale provider without affecting a replacement recording', async () => {
  let resolve!: (value: unknown) => void
  mocks.connect.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const { result } = renderHook(() => useInterviewRecorder())
  let starting!: Promise<void>
  await act(async () => { starting = result.current.start('mic'); await Promise.resolve() })
  const signal = mocks.connect.mock.calls[0][0].signal as AbortSignal
  await act(async () => { await result.current.stop() })
  expect(signal.aborted).toBe(true)
  await act(async () => result.current.start('mic'))
  const replacementEmit = emit
  const stopCount = mocks.browserStop.mock.calls.length
  const oldDisconnect = vi.fn().mockResolvedValue(undefined)
  await act(async () => { resolve({ name: 'Old', provider: { disconnect: oldDisconnect } }); await starting })
  expect(oldDisconnect).toHaveBeenCalledTimes(1)
  expect(result.current.phase).toBe('recording')
  expect(mocks.browserStop).toHaveBeenCalledTimes(stopCount)
  act(() => replacementEmit({ ...event, text: 'New recording' }))
  expect(captureText(result.current.getSegments())).toBe('New recording')
})

it('stops and flushes the established provider when browser sharing ends', async () => {
  const { result } = renderHook(() => useInterviewRecorder())
  await act(async () => result.current.start('system'))
  const options = mocks.browserStart.mock.calls[0][2]
  mocks.disconnect.mockImplementation(async () => { emit(event) })
  await act(async () => options.onEnded())
  expect(result.current.phase).toBe('idle')
  expect(captureText(result.current.getSegments())).toBe('Final answer')
  expect(mocks.nativeStop).toHaveBeenCalled()
})

it('cancels startup immediately on unmount and ignores a late provider', async () => {
  let resolve!: (value: unknown) => void
  mocks.connect.mockReturnValueOnce(new Promise((done) => { resolve = done }))
  const { result, unmount } = renderHook(() => useInterviewRecorder())
  let starting!: Promise<void>
  await act(async () => { starting = result.current.start('mic'); await Promise.resolve() })
  const signal = mocks.connect.mock.calls[0][0].signal as AbortSignal
  unmount()
  expect(signal.aborted).toBe(true)
  const oldDisconnect = vi.fn().mockResolvedValue(undefined)
  await act(async () => { resolve({ name: 'Late', provider: { disconnect: oldDisconnect } }); await starting })
  expect(oldDisconnect).toHaveBeenCalledTimes(1)
})

it('speaker-only split revisions retain the original arrival timestamp',async()=>{
  const {result}=renderHook(()=>useInterviewRecorder());await act(async()=>result.current.start('system'))
  act(()=>emit({...event,text:'Hello. Hi.',utteranceId:'stream:1'}))
  const original=result.current.segments[0].capturedAt
  act(()=>emit({...event,text:'Hello. Hi.',utteranceId:'stream:1',parts:[{text:'Hello.',speaker:0,startMs:0,endMs:40},{text:'Hi.',speaker:1,startMs:50,endMs:100}]}))
  expect(result.current.segments.map(p=>p.capturedAt)).toEqual([original,original])
})
