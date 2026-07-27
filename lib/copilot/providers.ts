import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { vendorForModel, type ThinkingConfig, type Effort } from './modes'
import { logError } from '@/lib/log'

// Vendor-agnostic streaming for the copilot answer route. Dispatches to OpenAI or
// Anthropic by model id, and applies PROMPT CACHING on both so the stable prefix
// (mode system + transcript + background) isn't re-billed on every follow-up:
//   - OpenAI: caches matching prefixes >=1024 tokens automatically (~50% off cached
//     input) as long as the prefix is byte-stable — we just order it stable-first.
//   - Anthropic: explicit cache_control on the last stable system block; a cache
//     read is ~10% of the input price. Big win for long transcripts + coding turns.

export type AnswerParams = {
  model: string
  system: string
  transcript: string
  context: string | null // retrieved grounding (per-mode uploaded context documents)
  history: { role: 'user' | 'assistant'; content: string }[]
  question: string
  image: string | null // base64 data URL, cost-controlled screen frame
  temperature: number
  // Per-mode generation posture (Anthropic thinking-capable models only). Omitted
  // for Haiku/OpenAI, where these params 400.
  thinking?: ThinkingConfig
  effort?: Effort
}

const BACKGROUND_PREFIX = 'YOUR BACKGROUND (ground the answer in this, do not invent beyond it):\n'
const TRANSCRIPT_PREFIX = 'TRANSCRIPT (most recent):\n'

function toReadable(iter: AsyncIterable<string>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of iter) if (text) controller.enqueue(encoder.encode(text))
      } catch (e) {
        // Error after headers already sent — log it and surface a short note in
        // the stream so the panel shows something instead of an empty answer.
        logError('copilot/providers/stream', e)
        controller.enqueue(encoder.encode('\n\n_(assistant error — please retry)_'))
      } finally {
        controller.close()
      }
    },
  })
}

// --- OpenAI ---------------------------------------------------------------
async function* openaiTokens(p: AnswerParams): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const userContent: OpenAI.Chat.ChatCompletionUserMessageParam['content'] = p.image
    ? [
        { type: 'text', text: p.question },
        { type: 'image_url', image_url: { url: p.image, detail: 'low' } },
      ]
    : p.question
  const stream = await client.chat.completions.create({
    model: p.model,
    stream: true,
    temperature: p.temperature,
    messages: [
      // Stable prefix first → OpenAI auto-caches it across follow-ups.
      { role: 'system', content: p.system },
      { role: 'system', content: `${TRANSCRIPT_PREFIX}${p.transcript || '(empty so far)'}` },
      ...(p.context ? [{ role: 'system' as const, content: `${BACKGROUND_PREFIX}${p.context}` }] : []),
      ...p.history,
      { role: 'user', content: userContent },
    ],
  })
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }
}

// --- Anthropic ------------------------------------------------------------
async function* anthropicTokens(p: AnswerParams): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  // System is an array of blocks; mark the LAST stable block cacheable so the
  // whole system+transcript prefix is cached (cache_control caches everything
  // up to and including the marked block).
  const system: Anthropic.MessageCreateParams['system'] = [
    { type: 'text', text: p.system },
    {
      type: 'text',
      text:
        `${TRANSCRIPT_PREFIX}${p.transcript || '(empty so far)'}` +
        (p.context ? `\n\n${BACKGROUND_PREFIX}${p.context}` : ''),
      cache_control: { type: 'ephemeral' },
    },
  ]
  const userBlocks: Anthropic.ContentBlockParam[] = [{ type: 'text', text: p.question }]
  if (p.image) {
    // data:image/jpeg;base64,XXXX → split media type + data for Anthropic's schema.
    const m = p.image.match(/^data:(image\/[a-z]+);base64,(.+)$/i)
    if (m) {
      userBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: m[1] as 'image/jpeg' | 'image/png', data: m[2] },
      })
    }
  }
  // Note: Claude Sonnet 5 / Opus 4.8 deprecate `temperature` (they manage their
  // own sampling) — do NOT send it, the API rejects the request if present.
  // Per-mode posture (from thinkingConfigFor): disabling thinking makes the answer
  // stream immediately (coding's approach-first prompt is the narratable reasoning);
  // systemDesign runs adaptive+summarized so the user sees visible progress.
  const stream = client.messages.stream({
    model: p.model,
    max_tokens: 1500,
    system,
    ...(p.thinking ? { thinking: p.thinking } : {}),
    ...(p.effort ? { output_config: { effort: p.effort } } : {}),
    messages: [
      ...p.history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: userBlocks },
    ],
  } as Anthropic.MessageStreamParams)
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}

// Stream a grounded answer from whichever vendor owns the model. Prompt caching
// on both. Returns a ReadableStream of UTF-8 tokens for the HTTP response.
export function streamAnswer(p: AnswerParams): ReadableStream<Uint8Array> {
  const tokens = vendorForModel(p.model) === 'anthropic' ? anthropicTokens(p) : openaiTokens(p)
  return toReadable(tokens)
}
