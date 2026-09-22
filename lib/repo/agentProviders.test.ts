// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRepoModel, streamRepoModel } from './agentProviders'

const provider = vi.hoisted(() => ({ claudeCreate: vi.fn(), claudeStream: vi.fn(), openaiCreate: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: provider.claudeCreate, stream: provider.claudeStream } } }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: provider.openaiCreate } } } }))

const request = (model: string) => ({ model, system: 'Analyze observed code only.', evidence: 'src/order.ts:1 publish()', signal: new AbortController().signal })
async function* events(items: unknown[]) { for (const item of items) yield item }
const drain = async (model: string) => {
  const result = []
  for await (const chunk of streamRepoModel(request(model))) result.push(chunk)
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('ANTHROPIC_API_KEY', 'test-key')
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('provider completion integrity', () => {
  it('accepts a complete Claude stream and preserves its returned model identity', async () => {
    provider.claudeStream.mockReturnValue(events([
      { type: 'message_start', message: { model: 'claude-actual' } },
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Inspect src/order.ts:1.' } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
      { type: 'message_stop' },
    ]))
    await expect(drain('claude-test')).resolves.toEqual([{ text: 'Inspect src/order.ts:1.', model: 'claude-actual' }])
  })

  it('rejects a Claude stream that ends after partial text without a completion event', async () => {
    provider.claudeStream.mockReturnValue(events([
      { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Incomplete patch:' } },
    ]))
    await expect(drain('claude-test')).rejects.toThrow(/completion|incomplete/i)
  })

  it.each(['refusal', 'tool_use', 'pause_turn'])('does not count Claude %s as a completed specialist opinion', async (reason) => {
    provider.claudeCreate.mockResolvedValue({ model: 'claude-actual', stop_reason: reason, content: [{ type: 'text', text: 'Unfinished response' }] })
    await expect(callRepoModel(request('claude-test'))).rejects.toThrow(/complete/i)
  })

  it('rejects filtered OpenAI output instead of treating a partial patch as complete', async () => {
    provider.openaiCreate.mockResolvedValue(events([
      { model: 'gpt-actual', choices: [{ delta: { content: 'Partial patch' }, finish_reason: null }] },
      { model: 'gpt-actual', choices: [{ delta: {}, finish_reason: 'content_filter' }] },
    ]))
    await expect(drain('gpt-test')).rejects.toThrow(/complete/i)
  })

  it('requires a final OpenAI stop reason, even if the transport closes cleanly', async () => {
    provider.openaiCreate.mockResolvedValue(events([
      { model: 'gpt-actual', choices: [{ delta: { content: 'Unfinished explanation' }, finish_reason: null }] },
    ]))
    await expect(drain('gpt-test')).rejects.toThrow(/completion|incomplete/i)
  })

  it('accepts a complete OpenAI stream, including its optional trailing usage event', async () => {
    provider.openaiCreate.mockResolvedValue(events([
      { model: 'gpt-actual', choices: [{ delta: { content: 'Check the state transition.' }, finish_reason: null }] },
      { model: 'gpt-actual', choices: [{ delta: {}, finish_reason: 'stop' }] },
      { model: 'gpt-actual', choices: [], usage: { total_tokens: 30 } },
    ]))
    await expect(drain('gpt-test')).resolves.toEqual([{ text: 'Check the state transition.', model: 'gpt-actual' }])
  })
})
