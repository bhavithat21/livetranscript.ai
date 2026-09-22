// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.create } } } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))
vi.mock('./modes', () => ({ vendorForModel: () => 'openai', fastFallbackModel: () => 'test', fallbackChain: () => [] }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
import { streamAnswer, type AnswerParams } from './providers'
const params: AnswerParams = { model: 'test', system: 'Grounded', transcript: '', context: null, history: [], question: 'Question?', image: null, temperature: 0 }
beforeEach(() => vi.resetAllMocks())

describe('provider stream completion contract', () => {
  it('propagates late provider failure instead of returning an error note as a successful answer', async () => {
    let fail!: () => void
    const gate = new Promise<void>((resolve) => { fail = resolve })
    mocks.create.mockImplementation(async () => (async function* () {
      yield { choices: [{ delta: { content: 'a'.repeat(64) } }] }
      await gate
      throw new Error('private provider details')
    })())
    const reader = streamAnswer(params).getReader()
    expect(new TextDecoder().decode((await reader.read()).value)).toBe('a'.repeat(64))
    fail()
    await expect(reader.read()).rejects.toThrow('Assistant response incomplete')
  })
  it('aborts the actual provider request when the consumer cancels its stream', async () => {
    let sdkSignal: AbortSignal | undefined
    let started!: () => void
    const ready = new Promise<void>((resolve) => { started = resolve })
    mocks.create.mockImplementation(async (_body: unknown, options: { signal: AbortSignal }) => {
      sdkSignal = options.signal
      started()
      return (async function* () {
        await new Promise<void>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      })()
    })
    const reader = streamAnswer(params).getReader()
    await ready
    await reader.cancel()
    expect(sdkSignal?.aborted).toBe(true)
  })
  it('passes the incoming request abort to the provider', async () => {
    const request = new AbortController()
    let signal!: AbortSignal
    mocks.create.mockImplementation(async (_body: unknown, options: { signal: AbortSignal }) => {
      signal = options.signal
      return (async function* () {
        yield { choices: [{ delta: { content: 'a'.repeat(64) } }] }
        await new Promise<void>((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
      })()
    })
    const reader = streamAnswer({ ...params, signal: request.signal }).getReader()
    await reader.read()
    request.abort()
    expect(signal.aborted).toBe(true)
    await expect(reader.read()).rejects.toThrow('incomplete')
  })
})
