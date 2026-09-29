// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { configuredDraftModel, modelForTier, fallbackChain } from './modes'
const mock = vi.hoisted(() => ({ create: vi.fn(), stream: vi.fn() }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mock.create } } } }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { stream: mock.stream } } }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))
import { streamAnswer } from './providers'
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('GROQ_API_KEY', 'fixture'); vi.stubEnv('ANTHROPIC_API_KEY', 'fixture'); vi.stubEnv('COPILOT_DRAFT_MODEL', ''); vi.stubEnv('COPILOT_MODEL_FAST', '') })
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
it('removes the retired default from both fast selection and fallback destinations', () => {
  expect(modelForTier('fast')).toBe('openai/gpt-oss-120b')
  expect(fallbackChain('claude-sonnet-5')).not.toContain('llama-3.3-70b-versatile')
})
it('honors an explicit fast/draft model and supports disabling drafts', () => {
  vi.stubEnv('COPILOT_MODEL_FAST', 'openai/gpt-oss-20b'); expect(configuredDraftModel()).toBe('openai/gpt-oss-20b')
  vi.stubEnv('COPILOT_DRAFT_MODEL', 'off'); expect(configuredDraftModel()).toBeNull()
})
it('a stalled draft cannot hold up the deep answer and is cancelled when deep output arrives', async () => {
  vi.useFakeTimers(); let draftSignal: AbortSignal | undefined
  mock.stream.mockImplementation(() => (async function* () { await new Promise(resolve => setTimeout(resolve, 1200)); yield { type: 'content_block_delta', delta: { type: 'text_delta', text: 'A'.repeat(70) } } })())
  mock.create.mockImplementation((_body, options) => { draftSignal = options.signal; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) })
  const reader = streamAnswer({ model: 'claude-fixture', system: '', transcript: '', context: null, history: [], question: 'Test', image: null, temperature: 0 }).getReader()
  const read = reader.read(); await vi.advanceTimersByTimeAsync(1250)
  expect(new TextDecoder().decode((await read).value)).toBe('A'.repeat(70))
  expect(draftSignal?.aborted).toBe(true); await reader.cancel()
})
