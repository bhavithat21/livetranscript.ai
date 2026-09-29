import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import type { parseRepoImage } from './agentHttp'
import { SCREEN_EXTRACTION_PROMPT } from './agentPrompts'
import { repoProvider, validRepoModel } from './modelPolicy'
import { parseScreenObservation, type ScreenObservation } from './screenEvidence'

export class ScreenExtractionError extends Error {
  constructor(message: string, public status: number, public model?: string, public usage?: ScreenTokenUsage) { super(message) }
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
  if (!validRepoModel(input.model)) throw new ScreenExtractionError('Invalid screenshot reconstruction model', 503)
  const provider = repoProvider(input.model)
  const timeout = AbortSignal.timeout(18_000)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  if (provider === 'anthropic') {
    if (!process.env.ANTHROPIC_API_KEY) throw new ScreenExtractionError('ANTHROPIC_API_KEY is required for this vision model', 503)
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 18_000 })
    const result = await client.messages.create({ model: input.model, max_tokens: 6000, system: SCREEN_EXTRACTION_PROMPT, messages: [{ role: 'user', content: [
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
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 18_000 })
  const result = await client.chat.completions.create({ model: input.model, max_completion_tokens: 6000, messages: [
    { role: 'system', content: SCREEN_EXTRACTION_PROMPT },
    { role: 'user', content: [{ type: 'text', text: 'Transcribe the visible code, paths, requirements and terminal evidence.' }, { type: 'image_url', image_url: { url: `data:${input.image.mediaType};base64,${input.image.data}` } }] },
  ] }, { signal })
  const usage = result.usage && Number.isSafeInteger(result.usage.prompt_tokens) && Number.isSafeInteger(result.usage.completion_tokens) ? { inputTokens: result.usage.prompt_tokens, outputTokens: result.usage.completion_tokens } : undefined
  if (result.choices[0]?.finish_reason === 'length') throw new ScreenExtractionError('Screenshot contains too much text. Capture a smaller visible region.', 422, result.model, usage)
  if (result.choices[0]?.finish_reason !== 'stop') throw new ScreenExtractionError('Screenshot extraction did not complete.', 502, result.model, usage)
  return parseResult(result.choices[0]?.message.content?.trim() || '', result.model, usage)
}

function parseResult(raw: string, model: string, usage?: ScreenTokenUsage): ScreenExtractionResult {
  const json = raw.replace(/^```(?:json)?\\s*\\n?/, '').replace(/\\n?```\\s*$/, '')
  let observation: ScreenObservation
  try { observation = parseScreenObservation(JSON.parse(json)) } catch { throw new ScreenExtractionError('Screenshot extraction returned invalid evidence. Try a clearer capture.', 502, model, usage) }
  return { observation, model, raw, ...(usage ? { usage } : {}) }
}
