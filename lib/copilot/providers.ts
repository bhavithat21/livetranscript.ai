import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { vendorForModel, configuredDraftModel, fallbackChain, type ThinkingConfig, type Effort } from './modes'
import { DRAFT_SENTINEL, REFINED_SENTINEL } from './draftProtocol'
import { logError } from '@/lib/log'

// Groq is OpenAI-compatible — same SDK, different base URL + key. Used for the
// fast tier (Llama 3.3 70B) where its throughput wins TTFT.
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
// Shared client options for BOTH SDKs. maxRetries: 0 — withFallbackChain already
// walks vendors, so the SDK must NOT silently retry the SAME failing vendor 2× with
// backoff first (that adds seconds before failover, defeating fast cross-vendor
// recovery and leaving a blank panel meanwhile). timeout bounds a stalled request
// (SDK default is ~10 min) so a hung upstream can't pin the invocation.
const CLIENT_OPTS = { maxRetries: 0, timeout: 30_000 } as const
// Two-pass: if the deep (smart-tier) answer hasn't produced a token within this
// window, show a fast draft to mask the latency, then swap to the deep answer.
const DRAFT_THRESHOLD_MS = 700
// The draft is a stop-gap, not the final answer — keep it short + snappy.
const DRAFT_MAX_TOKENS = 400

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
  // Max output tokens for this mode (long-form behavioral/coding need more headroom
  // or the answer truncates). Falls back to a safe default if unset.
  maxTokens?: number
  // Per-mode generation posture (Anthropic thinking-capable models only). Omitted
  // for Haiku/OpenAI, where these params 400.
  thinking?: ThinkingConfig
  effort?: Effort
  signal?: AbortSignal
}

// Default output cap when a caller doesn't specify a per-mode budget.
const DEFAULT_MAX_TOKENS = 1500

const BACKGROUND_PREFIX = 'YOUR BACKGROUND (ground the answer in this, do not invent beyond it):\n'
const TRANSCRIPT_PREFIX = 'TRANSCRIPT (most recent):\n'

function toReadable(iter: AsyncIterable<string>, abort: () => void): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  let closed = false
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const text of iter) {
          if (closed) break
          if (text) controller.enqueue(encoder.encode(text))
        }
      } catch (e) {
        if (!closed) {
          logError('copilot/providers/stream', e)
          // A provider failure must reject the reader, not become ordinary answer
          // text that the UI, code executor or Mock Lab calls a successful run.
          closed = true
          controller.error(new Error('Assistant response incomplete. Please retry.'))
        }
      } finally {
        if (!closed) { closed = true; controller.close() }
      }
    },
    cancel() { closed = true; abort() },
  })
}

// --- OpenAI / Groq (OpenAI-compatible) ------------------------------------
// Groq shares OpenAI's wire format, so one generator serves both — only the
// client (base URL + key) differs. `client` is injected so streamAnswer can point
// it at Groq for the fast tier or fall back to OpenAI.
async function* openaiTokens(p: AnswerParams, client: OpenAI): AsyncGenerator<string> {
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
    max_completion_tokens: p.maxTokens ?? DEFAULT_MAX_TOKENS,
    ...(p.model.includes('gpt-oss') ? { reasoning_effort: 'low' as const } : {}),
    messages: [
      // Stable prefix first → OpenAI auto-caches it across follow-ups.
      { role: 'system', content: p.system },
      { role: 'system', content: `${TRANSCRIPT_PREFIX}${p.transcript || '(empty so far)'}` },
      ...(p.context ? [{ role: 'system' as const, content: `${BACKGROUND_PREFIX}${p.context}` }] : []),
      ...p.history,
      { role: 'user', content: userContent },
    ],
  }, { signal: p.signal })
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) yield delta
  }
}

// --- Anthropic ------------------------------------------------------------
async function* anthropicTokens(p: AnswerParams): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...CLIENT_OPTS })
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
    max_tokens: p.maxTokens ?? DEFAULT_MAX_TOKENS,
    system,
    ...(p.thinking ? { thinking: p.thinking } : {}),
    ...(p.effort ? { output_config: { effort: p.effort } } : {}),
    messages: [
      ...p.history.map((h) => ({ role: h.role, content: h.content })),
      { role: 'user' as const, content: userBlocks },
    ],
  } as Anthropic.MessageStreamParams, { signal: p.signal })
  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text
    }
  }
}

// Build the token generator for whichever vendor owns the model.
function tokensFor(p: AnswerParams): AsyncGenerator<string> {
  const vendor = vendorForModel(p.model)
  if (vendor === 'anthropic') return anthropicTokens(p)
  if (vendor === 'groq') {
    return openaiTokens(p, new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: GROQ_BASE_URL, ...CLIENT_OPTS }))
  }
  return openaiTokens(p, new OpenAI({ apiKey: process.env.OPENAI_API_KEY, ...CLIENT_OPTS }))
}

// Cross-vendor resilience for EVERY role, not just the fast tier. If the primary
// model fails BEFORE any token is emitted (down / 429 / timeout / bad key), walk its
// fallbackChain — each entry a benchmark peer on a DIFFERENT vendor, ending in an
// always-reachable backstop — until one starts streaming. So a whole-vendor outage
// (Groq OR Anthropic OR OpenAI down) still yields an answer.
//
// A short COMMIT BUFFER before painting: we hold the first COMMIT_CHARS of a
// candidate's output before yielding anything. A failure while still buffering means
// NOTHING was shown yet, so we can silently fail over to the next vendor — this
// extends cross-vendor recovery past the very first token into the opening moments
// of the stream (the common "vendor dies after a few tokens → truncated garbage"
// case). At the fast tier's hundreds of tok/s the buffer fills in tens of ms
// (imperceptible). Once flushed (user is reading), a later failure re-throws and the
// client's watchdog + auto-retry take over — we never rewrite text already on screen.
const COMMIT_CHARS = 64

async function* withFallbackChain(p: AnswerParams): AsyncGenerator<string> {
  const candidates = [p.model, ...fallbackChain(p.model)]
  for (let i = 0; i < candidates.length; i++) {
    p.signal?.throwIfAborted()
    const model = candidates[i]
    const isLast = i === candidates.length - 1
    let committed = false // have we painted anything yet?
    let buffer = ''
    try {
      for await (const t of tokensFor({ ...p, model })) {
        if (committed) {
          yield t
          continue
        }
        buffer += t
        // Once the buffer clears the commit threshold, flush it and start streaming.
        if (buffer.length >= COMMIT_CHARS) {
          committed = true
          yield buffer
          buffer = ''
        }
      }
      // Stream ended cleanly. If it was shorter than the buffer, flush the remainder.
      if (!committed && buffer) yield buffer
      return
    } catch (e) {
      p.signal?.throwIfAborted()
      // If we already committed output, we can't switch vendors mid-read → propagate
      // (toReadable notes it, client auto-retries). If we FAILED BEFORE committing —
      // or this is the last candidate — otherwise fail over to the next vendor.
      if (committed || isLast) throw e
      logError(`copilot/providers/fallback:${vendorForModel(model)}`, e)
      // fall through to the next candidate (buffer discarded — nothing was shown)
    }
  }
}

// Two-pass "draft then refine": race the deep (smart-tier) answer's FIRST token
// against DRAFT_THRESHOLD_MS. If the deep answer is quick, stream it plainly — no
// draft, no swap (the "draft only if slow" UX). If it's slow, emit a fast Groq
// draft framed by sentinels to mask the wait, then, the instant the deep answer's
// first token is ready, emit REFINED_SENTINEL and stream the deep answer. The
// client (parseDraftStream) shows the draft badged as "Quick take" and cleanly
// replaces it with the refined answer.
async function* withSpeculativeDraft(p: AnswerParams): AsyncGenerator<string> {
  const draftModel = configuredDraftModel()
  if (!draftModel || draftModel === p.model) { yield* withFallbackChain(p); return }
  const deep = withFallbackChain(p)[Symbol.asyncIterator]()
  const firstDeep = deep.next()
  const deepReady = firstDeep.then(() => ({ kind: 'deep' as const }), () => ({ kind: 'deep' as const }))
  let timer: ReturnType<typeof setTimeout> | undefined
  const start = await Promise.race([deepReady, new Promise<{ kind: 'timeout' }>(resolve => { timer = setTimeout(() => resolve({ kind: 'timeout' }), DRAFT_THRESHOLD_MS) })])
  clearTimeout(timer)
  const cancellation = new AbortController()
  let draftShown = false
  try {
    if (start.kind === 'timeout') {
      const signal = p.signal ? AbortSignal.any([p.signal, cancellation.signal]) : cancellation.signal
      // Vision stays on the deep path; a text-only draft must not receive images.
      const draft = tokensFor({ ...p, image: null, model: draftModel, signal, maxTokens: DRAFT_MAX_TOKENS, thinking: undefined, effort: undefined })
      try {
        for (;;) {
          const next = draft.next().then(value => ({ kind: 'draft' as const, value }), error => ({ kind: 'error' as const, error }))
          const winner = await Promise.race([deepReady, next])
          if (winner.kind === 'deep') break
          if (winner.kind === 'error') throw winner.error
          if (winner.value.done) break
          if (winner.value.value) { if (!draftShown) { draftShown = true; yield DRAFT_SENTINEL }; yield winner.value.value }
        }
      } catch (error) { if (!p.signal?.aborted) logError('copilot/providers/draft', error) }
      finally { cancellation.abort(); void draft.return(undefined).catch(() => {}) }
    }
    const first = await firstDeep
    if (draftShown) yield REFINED_SENTINEL
    if (!first.done && first.value) yield first.value
    if (!first.done) for (;;) { const next = await deep.next(); if (next.done) break; if (next.value) yield next.value }
  } finally { cancellation.abort(); void deep.return?.(undefined).catch(() => {}) }
}

function shouldDraft(p: AnswerParams): boolean {
  return vendorForModel(p.model) === 'anthropic' && process.env.COPILOT_DRAFT_MODEL !== 'off'
}

/** Synthetic probes deliberately use the exact provider implementation without
 * fallback or speculation, so an inaccessible primary cannot appear healthy. */
export async function probeAnswerModel(model: string, signal: AbortSignal): Promise<void> {
  let text = ''
  for await (const part of tokensFor({ model, system: 'Reply with READY only.', question: 'Readiness check.', transcript: '', context: null, history: [], image: null, temperature: 0, maxTokens: 512, signal })) {
    text += part; if (text.length > 2000) throw new Error('Probe output budget exceeded')
  }
  if (!text.trim()) throw new Error('Model returned no probe text')
}

// Stream a grounded answer from whichever vendor owns the model, with a fast-tier
// fallback and (for slow smart-tier answers) a speculative fast draft. Returns a
// ReadableStream of UTF-8 tokens for the HTTP response.
export function streamAnswer(p: AnswerParams): ReadableStream<Uint8Array> {
  const cancellation = new AbortController()
  const signal = p.signal ? AbortSignal.any([p.signal, cancellation.signal]) : cancellation.signal
  const params = { ...p, signal }
  return toReadable(shouldDraft(params) ? withSpeculativeDraft(params) : withFallbackChain(params), () => cancellation.abort())
}
