import { SCREEN_SCHEMA, SCREEN_VALUE_RULES } from './screenSchema'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { parseRepoImage } from './agentHttp'
import { SCREEN_EXTRACTION_PROMPT } from './agentPrompts'
import { repoProvider, validRepoModel } from './modelPolicy'
import { parseScreenObservation, type ScreenObservation } from './screenEvidence'

export type ScreenValidationCode = 'invalid_json' | 'invalid_path' | 'invalid_language' | 'invalid_lines' | 'invalid_confidence' | 'invalid_shape'

export class ScreenExtractionError extends Error {
  constructor(message: string, public status: number, public model?: string, public usage?: ScreenTokenUsage, public validationCode?: ScreenValidationCode, public attempts = 1) { super(message) }
}

export type ScreenTokenUsage = { inputTokens: number; outputTokens: number }

export interface ScreenExtractionResult {
  observation: ScreenObservation
  model: string
  raw: string
  /** Total known usage, including a validation retry. Omitted if incomplete. */
  usage?: ScreenTokenUsage
  attempts?: number
}

type ExtractionInput = { model: string; image: ReturnType<typeof parseRepoImage>; signal?: AbortSignal }
const TIMEOUT_MS = 18_000

/** Same provider/model only; one validation retry shares the original deadline.
 * Refusals, truncation, cancellations and provider failures are never retried. */
export async function extractScreenEvidence(input: ExtractionInput): Promise<ScreenExtractionResult> {
  if (!validRepoModel(input.model)) throw new ScreenExtractionError('Invalid screenshot reconstruction model', 503)
  const timeout = AbortSignal.timeout(TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  signal.throwIfAborted()
  try {
    return { ...await requestEvidence(input, signal), attempts: 1 }
  } catch (first) {
    if (!(first instanceof ScreenExtractionError) || !first.validationCode || signal.aborted) throw first
    // Never echo rejected model output, paths or source into a correction prompt.
    const correction = `The previous response failed local validation (${first.validationCode}). Re-read the SAME image and obey the value rules. Omit evidence that cannot be represented faithfully; never invent or repair source.`
    try {
      signal.throwIfAborted()
      const result = await requestEvidence(input, signal, correction)
      return { ...result, usage: sumUsage(first.usage, result.usage), attempts: 2 }
    } catch (second) {
      if (second instanceof ScreenExtractionError) {
        second.attempts = 2
        second.usage = sumUsage(first.usage, second.usage)
      }
      throw second
    }
  }
}

function sumUsage(first?: ScreenTokenUsage, second?: ScreenTokenUsage): ScreenTokenUsage | undefined {
  if (!first || !second) return undefined
  return { inputTokens: first.inputTokens + second.inputTokens, outputTokens: first.outputTokens + second.outputTokens }
}

async function requestEvidence(input: ExtractionInput, signal: AbortSignal, correction = ''): Promise<ScreenExtractionResult> {
  const provider = repoProvider(input.model)
  const system = `${SCREEN_EXTRACTION_PROMPT}\n\n${SCREEN_VALUE_RULES}${correction ? `\n\n${correction}` : ''}`
  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new ScreenExtractionError('ANTHROPIC_API_KEY is required for this vision model', 503)
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: TIMEOUT_MS })
    const result = await client.messages.create({ model: input.model, max_tokens: 6000, output_config: { format: { type: 'json_schema', schema: SCREEN_SCHEMA } }, system, messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: input.image.mediaType, data: input.image.data } },
      { type: 'text', text: 'Transcribe the visible code, paths, requirements and terminal evidence.' },
    ] }] }, { signal })
    const usage = result.usage && Number.isSafeInteger(result.usage.input_tokens) && result.usage.input_tokens >= 0 && Number.isSafeInteger(result.usage.output_tokens) && result.usage.output_tokens >= 0 ? { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens } : undefined
    if (result.stop_reason === 'max_tokens') throw new ScreenExtractionError('Screenshot contains too much text. Capture a smaller visible region.', 422, result.model, usage)
    if (result.stop_reason !== 'end_turn') throw new ScreenExtractionError('Screenshot extraction did not complete.', 502, result.model, usage)
    const raw = result.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n').trim()
    return parseResult(raw, result.model, usage)
  }
  if (provider === 'groq') throw new ScreenExtractionError('Groq vision is not enabled for screenshot reconstruction.', 503)
  if (!process.env.OPENAI_API_KEY) throw new ScreenExtractionError('OPENAI_API_KEY is required for this vision model', 503)
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: TIMEOUT_MS })
  const result = await client.chat.completions.create({ model: input.model, max_completion_tokens: 6000, response_format: { type: 'json_schema', json_schema: { name: 'screen_evidence', strict: true, schema: SCREEN_SCHEMA } }, messages: [
    { role: 'system', content: system },
    { role: 'user', content: [{ type: 'text', text: 'Transcribe the visible code, paths, requirements and terminal evidence.' }, { type: 'image_url', image_url: { url: `data:${input.image.mediaType};base64,${input.image.data}` } }] },
  ] }, { signal })
  const usage = result.usage && Number.isSafeInteger(result.usage.prompt_tokens) && result.usage.prompt_tokens >= 0 && Number.isSafeInteger(result.usage.completion_tokens) && result.usage.completion_tokens >= 0 ? { inputTokens: result.usage.prompt_tokens, outputTokens: result.usage.completion_tokens } : undefined
  if (result.choices[0]?.finish_reason === 'length') throw new ScreenExtractionError('Screenshot contains too much text. Capture a smaller visible region.', 422, result.model, usage)
  if (result.choices[0]?.finish_reason !== 'stop') throw new ScreenExtractionError('Screenshot extraction did not complete.', 502, result.model, usage)
  return parseResult(result.choices[0]?.message.content?.trim() || '', result.model, usage)
}

function validationCode(error: unknown): ScreenValidationCode {
  // Only fixed categories leave this boundary; never expose a parser's raw message.
  const message = error instanceof Error ? error.message : ''
  if (/file path|workspace path/i.test(message)) return 'invalid_path'
  if (/language/i.test(message)) return 'invalid_language'
  if (/line|startLine/i.test(message)) return 'invalid_lines'
  if (/confidence/i.test(message)) return 'invalid_confidence'
  return 'invalid_shape'
}

function parseResult(raw: string, model: string, usage?: ScreenTokenUsage): ScreenExtractionResult {
  const json = raw.startsWith('```') ? raw.replace(/^```(?:json)?[ \t]*(?:\r?\n)?/, '').replace(/(?:\r?\n)?```[ \t]*$/, '') : raw
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch {
    throw new ScreenExtractionError('Screenshot extraction returned invalid evidence. Existing evidence is unchanged; retry analysis.', 502, model, usage, 'invalid_json')
  }
  let observation: ScreenObservation
  try { observation = parseScreenObservation(parsed) } catch (error) {
    throw new ScreenExtractionError('Screenshot extraction returned invalid evidence. Existing evidence is unchanged; retry analysis.', 502, model, usage, validationCode(error))
  }
  return { observation, model, raw, ...(usage ? { usage } : {}) }
}
