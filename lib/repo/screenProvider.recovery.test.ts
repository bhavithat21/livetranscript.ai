// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractScreenEvidence } from './screenProvider'
import { SCREEN_SCHEMA } from './screenSchema'

const mocks = vi.hoisted(() => ({ anthropic: vi.fn(), openai: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: mocks.anthropic } } }))
vi.mock('openai', () => ({ default: class { chat = { completions: { create: mocks.openai } } } }))
const input = { model: 'claude-test', image: { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' } }
const file = { path: 'Main.java', language: 'java', startLine: 1, lines: ['class Main {}'], confidence: 0.95, endOfFile: false }
const observation = { files: [file], visiblePaths: ['Main.java'], terminal: '', requirements: [] }
const reply = (value: unknown, stop_reason = 'end_turn') => ({ model: 'claude-actual', stop_reason, content: [{ type: 'text', text: JSON.stringify(value) }], usage: { input_tokens: 100, output_tokens: 25 } })
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('ANTHROPIC_API_KEY', 'unit-test-key'); vi.stubEnv('OPENAI_API_KEY', 'unit-test-key') })
afterEach(() => vi.unstubAllEnvs())

describe('screenshot validation recovery', () => {
  it('re-reads the same image once after semantic validation fails, retaining strict validation', async () => {
    mocks.anthropic.mockResolvedValueOnce(reply({ ...observation, files: [{ ...file, language: 'Java (OpenJDK 21)', lines: ['PRIVATE_SOURCE_SENTINEL'] }] })).mockResolvedValueOnce(reply(observation))
    const result = await extractScreenEvidence(input)
    expect(result).toMatchObject({ observation, attempts: 2, usage: { inputTokens: 200, outputTokens: 50 } })
    expect(mocks.anthropic).toHaveBeenCalledTimes(2)
    const [first, second] = mocks.anthropic.mock.calls
    expect(second[1].signal).toBe(first[1].signal)
    expect(second[0].messages).toEqual(first[0].messages)
    expect(second[0].model).toBe(first[0].model)
    expect(second[0].system).toContain('invalid_language')
    expect(second[0].system).not.toContain('PRIVATE_SOURCE_SENTINEL')
  })

  it('never sanitizes an unsafe path into accepted evidence and stops after two attempts', async () => {
    mocks.anthropic.mockResolvedValue(reply({ ...observation, files: [{ ...file, path: '../private.txt' }] }))
    const failure = await extractScreenEvidence(input).catch(error => error)
    expect(failure).toMatchObject({ status: 502, validationCode: 'invalid_path', attempts: 2 })
    expect(mocks.anthropic).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(failure)).not.toContain('../private.txt')
    expect(failure).not.toHaveProperty('raw')
  })

  it.each(['refusal', 'max_tokens', 'tool_use', 'stop_sequence'])('does not retry incomplete or refused output (%s)', async (reason) => {
    mocks.anthropic.mockResolvedValue(reply(observation, reason))
    await expect(extractScreenEvidence(input)).rejects.toBeInstanceOf(Error)
    expect(mocks.anthropic).toHaveBeenCalledTimes(1)
  })

  it('does not retry provider errors or silently switch providers', async () => {
    mocks.anthropic.mockRejectedValue(Object.assign(new Error('provider unavailable'), { status: 404 }))
    await expect(extractScreenEvidence(input)).rejects.toMatchObject({ status: 404 })
    expect(mocks.anthropic).toHaveBeenCalledTimes(1)
    expect(mocks.openai).not.toHaveBeenCalled()
  })

  it('does not start another request after cancellation', async () => {
    const abort = new AbortController()
    mocks.anthropic.mockImplementation(async () => { abort.abort(); return reply({ ...observation, files: [{ ...file, startLine: 0 }] }) })
    await expect(extractScreenEvidence({ ...input, signal: abort.signal })).rejects.toBeInstanceOf(Error)
    expect(mocks.anthropic).toHaveBeenCalledTimes(1)
  })

  it('does not send an already cancelled request', async () => {
    const abort = new AbortController(); abort.abort()
    await expect(extractScreenEvidence({ ...input, signal: abort.signal })).rejects.toBeInstanceOf(Error)
    expect(mocks.anthropic).not.toHaveBeenCalled()
  })

  it('does not report partial retry usage as a complete total', async () => {
    mocks.anthropic.mockResolvedValueOnce({ ...reply({ ...observation, files: [{ ...file, confidence: 90 }] }), usage: undefined }).mockResolvedValueOnce(reply(observation))
    expect((await extractScreenEvidence(input)).usage).toBeUndefined()
  })

  it('supports the same bounded recovery on the OpenAI path', async () => {
    const response = (value: unknown) => ({ model: 'gpt-actual', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 20, completion_tokens: 10 } })
    mocks.openai.mockResolvedValueOnce(response({ ...observation, files: [{ ...file, lines: [] }] })).mockResolvedValueOnce(response(observation))
    await expect(extractScreenEvidence({ ...input, model: 'gpt-4.1' })).resolves.toMatchObject({ observation, attempts: 2, usage: { inputTokens: 40, outputTokens: 20 } })
    expect(mocks.openai.mock.calls[0][1].signal).toBe(mocks.openai.mock.calls[1][1].signal)
    expect(mocks.anthropic).not.toHaveBeenCalled()
  })

  it('constrains empty fragments, display-label languages and embedded newlines at generation time', () => {
    const fields = SCREEN_SCHEMA.properties.files.items.properties
    expect(fields.lines.minItems).toBe(1)
    expect(new RegExp(fields.language.pattern).test('Java (OpenJDK 21)')).toBe(false)
    expect(new RegExp(fields.language.pattern).test('c++')).toBe(true)
    expect(new RegExp(fields.lines.items.pattern).test('one\ntwo')).toBe(false)
    expect(new RegExp(fields.lines.items.pattern).test('')).toBe(true)
  })
})
