// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extractScreenEvidence } from './screenProvider'

const { create } = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create } } }))
const observation = { files: [], visiblePaths: [], terminal: '', requirements: [] }
const input = { model: 'claude-test', image: { mediaType: 'image/png' as const, data: 'iVBORw0KGgo=' } }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('ANTHROPIC_API_KEY', 'unit-test-key') })
afterEach(() => vi.unstubAllEnvs())

describe('production screenshot extraction completion boundary', () => {
  it.each([null, 'tool_use', 'refusal', 'stop_sequence'])('rejects valid-looking JSON when the provider did not complete (%s)', async (stop_reason) => {
    create.mockResolvedValue({ model: 'claude-actual', stop_reason, content: [{ type: 'text', text: JSON.stringify(observation) }] })
    await expect(extractScreenEvidence(input)).rejects.toMatchObject({ status: 502 })
  })
  it('retains actual provider identity and usage for completed extraction measurements', async () => {
    create.mockResolvedValue({ model: 'claude-actual', stop_reason: 'end_turn', content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(observation)}\n\`\`\`` }], usage: { input_tokens: 125, output_tokens: 34 } })
    await expect(extractScreenEvidence(input)).resolves.toMatchObject({ model: 'claude-actual', observation, usage: { inputTokens: 125, outputTokens: 34 } })
  })
  it.each([
    { stop_reason: 'max_tokens', text: JSON.stringify(observation), status: 422 },
    { stop_reason: 'refusal', text: JSON.stringify(observation), status: 502 },
    { stop_reason: 'end_turn', text: 'private provider response that is not JSON', status: 502 },
  ])('retains billed response telemetry after rejecting $stop_reason without exposing raw content', async ({ stop_reason, text, status }) => {
    create.mockResolvedValue({ model: 'claude-actual', stop_reason, content: [{ type: 'text', text }], usage: { input_tokens: 125, output_tokens: 34 } })
    const error = await extractScreenEvidence(input).catch((failure: unknown) => failure)
    expect(error).toMatchObject({ status, model: 'claude-actual', usage: { inputTokens: 125, outputTokens: 34 } })
    expect(error).not.toHaveProperty('raw')
    expect(JSON.stringify(error)).not.toContain(text)
  })
})
