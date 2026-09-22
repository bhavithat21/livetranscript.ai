// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRepoModel, repoGenerationSettings, streamRepoModel } from './agentProviders'

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
  vi.stubEnv('GROQ_API_KEY', 'test-key')
})
afterEach(() => vi.unstubAllEnvs())

describe('provider completion integrity', () => {
  it('retains billed model and tokens when a specialist hits its output limit', async () => {
    provider.claudeCreate.mockResolvedValue({ model: 'claude-actual', stop_reason: 'max_tokens', content: [], usage: { input_tokens: 100, output_tokens: 2200 } })
    await expect(callRepoModel(request('claude-test'))).rejects.toMatchObject({ model: 'claude-actual', usage: { inputTokens: 100, outputTokens: 2200 } })
  })

  it('reads Groq terminal usage from x_groq for measured synthesis cost', async () => {
    provider.openaiCreate.mockResolvedValue(events([
      { model: 'openai/gpt-oss-20b', choices: [{ delta: { content: 'Inspect src/order.ts:1.' }, finish_reason: 'stop' }] },
      { model: 'openai/gpt-oss-20b', choices: [], x_groq: { usage: { prompt_tokens: 80, completion_tokens: 50 } } },
    ]))
    const onUsage = vi.fn()
    for await (const chunk of streamRepoModel({ ...request('openai/gpt-oss-20b'), onUsage })) expect(chunk.text).toBeTruthy()
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 80, outputTokens: 50 })
  })

  it('retains trailing usage on an incomplete OpenAI stream', async () => {
    provider.openaiCreate.mockResolvedValue(events([
      { model: 'gpt-actual', choices: [{ delta: { content: 'Partial' }, finish_reason: 'length' }] },
      { model: 'gpt-actual', choices: [], usage: { prompt_tokens: 80, completion_tokens: 256 } },
    ]))
    await expect(drain('gpt-test')).rejects.toMatchObject({ model: 'gpt-actual', usage: { inputTokens: 80, outputTokens: 256 } })
  })

  it('uses a reasoning budget and supported effort for frontier models', async () => {
    provider.openaiCreate.mockResolvedValue({ model: 'gpt-6-astra-actual', choices: [{ finish_reason: 'stop', message: { content: 'Check the transition.' } }], usage: { prompt_tokens: 45, completion_tokens: 80 } })
    const result = await callRepoModel(request('gpt-6-astra'))
    expect(result.usage).toEqual({ inputTokens: 45, outputTokens: 80 })
    expect(provider.openaiCreate.mock.calls[0][0]).toMatchObject({ max_completion_tokens: 8192, reasoning_effort: 'low' })
    expect(provider.openaiCreate.mock.calls[0][0]).not.toHaveProperty('temperature')
    expect(repoGenerationSettings('claude-haiku-4-5')).not.toHaveProperty('effort')
  })

  it('rejects invalid budget settings instead of silently benchmarking different configurations', () => {
    vi.stubEnv('COPILOT_REPO_MAX_OUTPUT_TOKENS', '-10')
    expect(() => repoGenerationSettings('gpt-6-astra')).toThrow(/budget/)
  })

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
