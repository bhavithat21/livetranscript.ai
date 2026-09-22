import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeepgramProvider } from './deepgram'
import { AssemblyAIProvider } from './assemblyai'
import { connectWithFallback } from './index'
import type { TranscriptionProvider } from './types'

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
  constructor() { Socket.instances.push(this) }
  open() { this.readyState = 1; this.onopen?.() }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}
const fetchToken = vi.fn()
const config = { keyterms: [], sampleRate: 16_000, maxSpeakers: 1 }
const engines = [
  { name: 'Deepgram', make: () => new DeepgramProvider(), final: { channel: { alternatives: [{ transcript: 'Final words', words: [] }] }, is_final: true } },
  { name: 'AssemblyAI', make: () => new AssemblyAIProvider(), final: { type: 'Turn', transcript: 'Final words', end_of_turn: true, words: [] } },
]
beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  Socket.instances.length = 0
  fetchToken.mockResolvedValue({ ok: true, json: async () => ({ token: 'temporary-test-token' }) })
  vi.stubGlobal('fetch', fetchToken)
  vi.stubGlobal('WebSocket', Socket)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

for (const engine of engines) describe(`${engine.name} cancellation`, () => {
  it('aborts token minting before a websocket can be created', async () => {
    const abort = new AbortController()
    fetchToken.mockImplementation((_url: string, options: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }))
    const connected = engine.make().connect({ ...config, signal: abort.signal })
    const rejected = expect(connected).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await rejected
    expect(fetchToken.mock.calls[0][1].signal).toBe(abort.signal)
    expect(Socket.instances).toHaveLength(0)
  })

  it('closes a pending handshake on cancellation and clears connection timers', async () => {
    const abort = new AbortController()
    const connected = engine.make().connect({ ...config, signal: abort.signal })
    await Promise.resolve(); await Promise.resolve()
    expect(Socket.instances).toHaveLength(1)
    const rejected = expect(connected).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    await rejected
    expect(Socket.instances[0].close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the live stream without reporting a connection failure or delivering stale words', async () => {
    const abort = new AbortController()
    const provider = engine.make()
    const connected = provider.connect({ ...config, signal: abort.signal })
    await Promise.resolve(); await Promise.resolve()
    const socket = Socket.instances[0]
    socket.open()
    await connected
    const final = vi.fn()
    const status = vi.fn()
    provider.onFinal(final)
    provider.onStatus?.(status)
    abort.abort()
    socket.message(engine.final)
    provider.sendAudio(new ArrayBuffer(4))
    expect(final).not.toHaveBeenCalled()
    expect(status).not.toHaveBeenCalled()
    expect(socket.send).not.toHaveBeenCalled()
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves normal disconnect final-word flushing when capture was not aborted', async () => {
    const abort = new AbortController()
    const provider = engine.make()
    const connected = provider.connect({ ...config, signal: abort.signal })
    await Promise.resolve(); await Promise.resolve()
    const socket = Socket.instances[0]
    socket.open()
    await connected
    const final = vi.fn()
    provider.onFinal(final)
    const disconnected = provider.disconnect()
    socket.message(engine.final)
    await disconnected
    expect(final).toHaveBeenCalledWith(expect.objectContaining({ text: 'Final words', isFinal: true }))
    expect(abort.signal.aborted).toBe(false)
    expect(socket.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})

it('does not try a fallback provider after cancellation and retires the partially connected provider', async () => {
  const abort = new AbortController()
  const disconnect = vi.fn().mockResolvedValue(undefined)
  const fallback = vi.fn()
  const primary = {
    connect: vi.fn(async () => { abort.abort(); throw new DOMException('Cancelled', 'AbortError') }),
    disconnect,
  } as unknown as TranscriptionProvider
  await expect(connectWithFallback({ ...config, signal: abort.signal }, [
    { name: 'Primary', make: () => primary }, { name: 'Fallback', make: fallback },
  ])).rejects.toMatchObject({ name: 'AbortError' })
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(fallback).not.toHaveBeenCalled()
})
