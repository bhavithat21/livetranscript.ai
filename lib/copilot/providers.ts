import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { vendorForModel, fastFallbackModel, fallbackChain, type ThinkingConfig, type Effort } from './modes'
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
}

// Default output cap when a caller doesn't specify a per-mode budget.
const DEFAULT_MAX_TOKENS = 1500

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
    max_tokens: p.maxTokens ?? DEFAULT_MAX_TOKENS,
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
  } as Anthropic.MessageStreamParams)
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
// Once tokens have STARTED we can't switch vendors mid-stream (the user may already
// be reading), so a late failure re-throws and surfaces the "please retry" note —
// and the client's watchdog + auto-retry (useAnswerFeed/useCopilot) covers that.
async function* withFallbackChain(p: AnswerParams): AsyncGenerator<string> {
  const candidates = [p.model, ...fallbackChain(p.model)]
  for (let i = 0; i < candidates.length; i++) {
    const model = candidates[i]
    const isLast = i === candidates.length - 1
    let started = false
    try {
      for await (const t of tokensFor({ ...p, model })) {
        started = true
        yield t
      }
      return // finished cleanly
    } catch (e) {
      // Mid-stream failure, or the last candidate failed → propagate so toReadable
      // notes it and the client retries. Otherwise log and try the next vendor.
      if (started || isLast) throw e
      logError(`copilot/providers/fallback:${vendorForModel(model)}`, e)
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
  const deep = withFallbackChain(p)[Symbol.asyncIterator]()
  // Kick off the deep answer's first token immediately (don't await yet). Track its
  // outcome with a plain flag so the draft loop can stop the instant it settles —
  // whether the deep answer succeeded OR failed. deepFailed records a first-token
  // error (Anthropic 429/529/500 is common on the smart tier) so we can keep the
  // draft the user is reading instead of swapping it for an error note.
  let deepSettled = false
  let deepFailed = false
  const firstDeep = deep.next()
  // BOTH handlers attached: without an onRejected, a first-token rejection would
  // become an unhandled promise rejection (can terminate the serverless invocation).
  // The rejection is still surfaced through drainDeep()'s await below — this handler
  // only records state, it doesn't swallow the error path.
  void firstDeep.then(
    () => { deepSettled = true },
    () => { deepSettled = true; deepFailed = true },
  )
  const timer = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), DRAFT_THRESHOLD_MS))
  // Guard the race's readiness branch too, so a fast rejection here doesn't create a
  // second unhandled leaf; a first-token error resolves the race as 'ready' and the
  // error then surfaces through drainDeep().
  const raced = await Promise.race([firstDeep.then(() => 'ready' as const, () => 'ready' as const), timer])

  // Drain the deep generator from its already-started first token to exhaustion.
  async function* drainDeep(): AsyncGenerator<string> {
    const first = await firstDeep
    if (!first.done && first.value) yield first.value
    for (;;) {
      const n = await deep.next()
      if (n.done) return
      if (n.value) yield n.value
    }
  }

  if (raced === 'ready') {
    // Deep answer's first token settled before the threshold — stream it straight,
    // no draft/no swap. (If it settled as an ERROR, drainDeep rethrows and toReadable
    // notes it — same as the non-draft path.)
    yield* drainDeep()
    return
  }

  // Deep answer is slow — fill the gap with a fast Groq draft, then swap. If the
  // draft itself errors (Groq down/rate-limited), fall through and just wait on the
  // deep answer with no draft rather than failing.
  let draftEmitted = false
  try {
    const draftModel = fastFallbackModelForDraft()
    const draftGen = tokensFor({ ...p, model: draftModel, maxTokens: DRAFT_MAX_TOKENS, thinking: undefined, effort: undefined })
    for await (const t of draftGen) {
      // Stop drafting the moment the deep answer's first token settles (success or
      // failure) — no point extending a draft we're about to replace or fall back to.
      if (deepSettled) break
      if (t) {
        if (!draftEmitted) { draftEmitted = true; yield DRAFT_SENTINEL }
        yield t
      }
    }
  } catch (e) {
    logError('copilot/providers/draft', e)
  }

  // If the deep answer FAILED after we already showed a draft, keep the draft the
  // user is reading rather than swapping it for an error note (which would yank a
  // good answer out from under them). Stay in 'draft' phase and stop here — the
  // draft IS the answer now. useAnswerFeed's auto-retry can still fetch a fresh one.
  if (deepFailed && draftEmitted) return
  if (deepFailed) {
    // No draft was shown — surface the deep error the normal way.
    yield* drainDeep()
    return
  }

  // Switch to the deep answer. Only emit REFINED_SENTINEL if a draft was shown
  // (else the client is in 'final' phase and needs no swap marker).
  if (draftEmitted) yield REFINED_SENTINEL
  yield* drainDeep()
}

// The draft always uses a fast model regardless of the deep tier's vendor: Groq if
// keyed (fastest), else the standard fast fallback (Haiku/OpenAI).
function fastFallbackModelForDraft(): string {
  return process.env.GROQ_API_KEY ? 'llama-3.3-70b-versatile' : fastFallbackModel()
}

// Whether a mode/model should use the two-pass draft: only the smart tier benefits
// (the fast tier is already sub-second, so a draft would just add a pointless swap).
function shouldDraft(p: AnswerParams): boolean {
  // Groq/OpenAI fast models: no draft. Anthropic smart models: draft. An image
  // (vision) answer is inherently smart-tier and slow → also drafts.
  return vendorForModel(p.model) === 'anthropic' && !!process.env.GROQ_API_KEY
}

// Stream a grounded answer from whichever vendor owns the model, with a fast-tier
// fallback and (for slow smart-tier answers) a speculative fast draft. Returns a
// ReadableStream of UTF-8 tokens for the HTTP response.
export function streamAnswer(p: AnswerParams): ReadableStream<Uint8Array> {
  return toReadable(shouldDraft(p) ? withSpeculativeDraft(p) : withFallbackChain(p))
}
