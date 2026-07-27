import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { modeProfile, modelForTier, vendorForModel, thinkingConfigFor, fastFallbackModel } from '@/lib/copilot/modes'
import { streamAnswer } from '@/lib/copilot/providers'

// On-demand copilot answer. Streams tokens back grounded in the transcript the
// caller passes. Mirrors the auth-guard + input-cap + fail-soft conventions of
// /api/summarize and /api/correct, but is the app's FIRST streaming route:
// returns a ReadableStream so the first token paints in ~0.9s instead of the
// user waiting for the full generation.
//
// ACCURACY: the prompt is grounded — answer from the transcript, and say so when
// the answer isn't there rather than inventing it (the field's #1 failure).
// LATENCY: prompt ordered [fixed system][transcript tail][question LAST] so the
// stable prefix is prompt-cacheable across follow-ups; fast model by default.

const MAX_TRANSCRIPT = 60_000
const MAX_QUESTION = 2_000
const MAX_HISTORY = 8
// A prior ASSISTANT turn can be a full two-story behavioral answer (~4k chars); cap
// it well above MAX_QUESTION so history isn't clipped mid-story — which would break
// the behavioral no-reuse memory (the model must see the whole story it already told).
const MAX_HISTORY_CONTENT = 8_000
const MAX_INSTRUCTIONS = 4_000
// A downscaled JPEG data URL is well under this; caps a hostile/oversized payload.
const MAX_IMAGE_CHARS = 1_200_000 // ~900KB base64

// Match C0 control chars (0x00-0x1F) + DEL (0x7F), built without literal control
// chars in source so the file stays clean-editable.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')

type ChatTurn = { role: 'user' | 'assistant'; content: string }

// Collapse control chars to spaces (keeps normal text/whitespace) + cap. The
// transcript/question are untrusted input.
function clean(s: string, max: number): string {
  return s.replace(CONTROL_CHARS, ' ').slice(0, max)
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    question?: string
    transcript?: string
    history?: ChatTurn[]
    mode?: string
    image?: string // optional screen frame, base64 data URL (Phase 2 vision)
    context?: string // optional retrieved grounding (per-mode uploaded documents, Phase 3 RAG)
    instructions?: string // optional user-authored "how to answer" for this mode's chat
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const profile = modeProfile(body.mode) // coding / systemDesign / behavioral / general
  // Only accept a well-formed, size-capped image data URL; ignore anything else.
  const image =
    typeof body.image === 'string' &&
    body.image.startsWith('data:image/') &&
    body.image.length <= MAX_IMAGE_CHARS
      ? body.image
      : null
  const question = clean(body.question?.trim() ?? '', MAX_QUESTION).trim()
  if (!question) return Response.json({ error: 'Empty question' }, { status: 400 })
  // Keep the MOST RECENT transcript (tail) — what "answer about what was just
  // said" needs, and it bounds token cost.
  const transcript = clean((body.transcript ?? '').slice(-MAX_TRANSCRIPT), MAX_TRANSCRIPT)
  // Retrieved grounding (e.g. a matched chunk from the user's uploaded context
  // documents) — untrusted, capped.
  const context = clean((body.context ?? '').slice(0, MAX_TRANSCRIPT), MAX_TRANSCRIPT)
  // User-authored instructions for HOW this mode's chat should answer (e.g. "cite
  // page numbers", "answer in French") — untrusted, capped, appended to the
  // mode's fixed system prompt rather than replacing it.
  const instructions = clean((body.instructions ?? '').trim().slice(0, MAX_INSTRUCTIONS), MAX_INSTRUCTIONS)
  const history: ChatTurn[] = Array.isArray(body.history)
    ? body.history
        .filter((t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.content === 'string')
        .slice(-MAX_HISTORY)
        .map((t) => ({ role: t.role, content: clean(t.content, MAX_HISTORY_CONTENT) }))
    : []

  // Purpose-specific model: coding/design => smart (Claude), behavioral/general
  // => fast (Groq). A screen read needs the stronger vision model, so force
  // 'smart' when an image is attached.
  let model = modelForTier(image ? 'smart' : profile.tier)
  // Degrade to a reachable model if the chosen vendor has no key configured, so
  // the copilot still answers rather than erroring. Groq's own runtime failures
  // (rate limit, outage) are handled by the fast-tier fallback inside streamAnswer.
  const keyFor = (m: string): boolean => {
    switch (vendorForModel(m)) {
      case 'anthropic': return !!process.env.ANTHROPIC_API_KEY
      case 'groq': return !!process.env.GROQ_API_KEY
      case 'openai': return !!process.env.OPENAI_API_KEY
      default: return true
    }
  }
  if (!keyFor(model)) model = fastFallbackModel()
  if (!keyFor(model)) return Response.json({ error: 'Assistant unavailable' }, { status: 500 })

  // Append the user's own instructions to the mode's fixed system prompt (never
  // replace it — the mode's grounding/format rules still apply).
  const system = instructions
    ? `${profile.system}\n\nADDITIONAL INSTRUCTIONS from the user for how to answer in this chat:\n${instructions}`
    : profile.system

  // Per-mode thinking/effort, resolved against the model actually chosen (an image
  // forces the smart model). Disabled for chat/behavioral latency; summarized
  // thinking only for system design.
  const posture = thinkingConfigFor(body.mode, model)

  try {
    const readable = streamAnswer({
      model,
      system,
      transcript,
      context: context || null,
      history,
      question,
      image,
      temperature: profile.temperature,
      maxTokens: profile.maxTokens,
      thinking: posture.thinking,
      effort: posture.effort,
    })
    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    logError('api/copilot/answer', e)
    return Response.json({ error: 'Assistant failed' }, { status: 502 })
  }
}
