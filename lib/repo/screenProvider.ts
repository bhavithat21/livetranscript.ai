import Anthropic from '@anthropic-ai/sdk'
import type { parseRepoImage } from './agentHttp'
import { SCREEN_EXTRACTION_PROMPT } from './agentPrompts'
import { validRepoModel } from './modelPolicy'
import { parseScreenObservation, type ScreenObservation } from './screenEvidence'
import type { ScreenErrorCode } from '../coach/screenErrors'

const SCREEN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['files', 'visiblePaths', 'terminal', 'requirements'],
  properties: {
    files: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'language', 'startLine', 'lines', 'confidence', 'endOfFile'], properties: {
      path: { type: 'string' }, language: { type: 'string' }, startLine: { type: ['integer', 'null'] }, lines: { type: 'array', items: { type: 'string' } }, confidence: { type: 'number' }, endOfFile: { type: 'boolean' },
    } } },
    visiblePaths: { type: 'array', items: { type: 'string' } }, terminal: { type: 'string' }, requirements: { type: 'array', items: { type: 'string' } },
  },
}

export class ScreenExtractionError extends Error {
  constructor(message: string, public status: number, public model?: string, public usage?: ScreenTokenUsage, public code: ScreenErrorCode = 'provider') { super(message) }
}

export type ScreenTokenUsage = { inputTokens: number; outputTokens: number }

export interface ScreenExtractionResult {
  observation: ScreenObservation
  model: string
  raw: string
  usage?: ScreenTokenUsage
}

/** Shared by the authenticated route and opt-in visual measurements. No hidden fallback. */
export async function extractScreenEvidence(input: {
  model: string
  image: ReturnType<typeof parseRepoImage>
  signal?: AbortSignal
}): Promise<ScreenExtractionResult> {
  if (!validRepoModel(input.model) || !input.model.startsWith('claude-') || !process.env.ANTHROPIC_API_KEY) {
    throw new ScreenExtractionError('Screenshot reconstruction requires ANTHROPIC_API_KEY and a Claude vision model', 503, undefined, undefined, 'configuration')
  }
  const timeout = AbortSignal.timeout(35_000)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 35_000 })
  const result = await client.messages.create({
    model: input.model,
    max_tokens: 6000,
    // Transcription must not spend a hidden reasoning budget before returning
    // visible text. Extraction confidence and exact evidence checks still apply.
    ...(/^claude-sonnet-5(?:-|$)/.test(input.model) ? { thinking: { type: 'disabled' as const }, output_config: { format: { type: 'json_schema' as const, schema: SCREEN_SCHEMA } } } : {}),
    system: [{ type: 'text', text: SCREEN_EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.data } },
      { type: 'text', text: 'Transcribe the visible code, paths, requirements and terminal evidence.' },
    ] }],
  }, { signal })
  // A completed API response can be billed even when its content is unusable.
  // Preserve only safe model/token telemetry before applying completion/schema checks.
  const usage = result.usage && Number.isSafeInteger(result.usage.input_tokens) && result.usage.input_tokens >= 0
    && Number.isSafeInteger(result.usage.output_tokens) && result.usage.output_tokens >= 0
    ? { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens }
    : undefined
  if (result.stop_reason === 'max_tokens') {
    throw new ScreenExtractionError('Screenshot contains too much text. Capture a smaller visible region.', 422, result.model, usage, 'budget')
  }
  if (result.stop_reason !== 'end_turn') throw new ScreenExtractionError('Screenshot extraction did not complete.', 502, result.model, usage)
  const raw = result.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n').trim()
  // A fenced JSON object is harmless; extracting a convenient object from prose is not.
  const json = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  let observation: ScreenObservation
  try { observation = parseScreenObservation(JSON.parse(json)) } catch {
    throw new ScreenExtractionError('Screenshot extraction returned invalid evidence. Try a clearer capture.', 502, result.model, usage, 'format')
  }
  return { observation, model: result.model, raw, ...(usage ? { usage } : {}) }
}
