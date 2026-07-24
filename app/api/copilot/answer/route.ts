import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { modeProfile, modelForTier } from '@/lib/copilot/modes'

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
  const history: ChatTurn[] = Array.isArray(body.history)
    ? body.history
        .filter((t) => (t?.role === 'user' || t?.role === 'assistant') && typeof t.content === 'string')
        .slice(-MAX_HISTORY)
        .map((t) => ({ role: t.role, content: clean(t.content, MAX_QUESTION) }))
    : []

  const key = process.env.OPENAI_API_KEY
  if (!key) return Response.json({ error: 'Assistant unavailable' }, { status: 500 })

  try {
    const client = new OpenAI({ apiKey: key })
    // Final turn is multimodal only when a screen frame is attached. detail:'low'
    // keeps the image at a flat ~85 tokens — cost-controlled screen reads.
    const userContent: OpenAI.Chat.ChatCompletionUserMessageParam['content'] = image
      ? [
          { type: 'text', text: question },
          { type: 'image_url', image_url: { url: image, detail: 'low' } },
        ]
      : question
    // Purpose-specific model: the mode's tier (coding/design => smart, behavioral/
    // general => fast). A screen read needs the stronger vision model regardless
    // of mode, so force 'smart' when an image is attached.
    const model = modelForTier(image ? 'smart' : profile.tier)
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      temperature: profile.temperature, // per-mode: factual coding vs looser behavioral
      messages: [
        // Stable prefix first (mode system + transcript) → prompt-cacheable across
        // follow-ups; the volatile question (+ optional frame) goes LAST.
        { role: 'system', content: profile.system },
        { role: 'system', content: `TRANSCRIPT (most recent):\n${transcript || '(empty so far)'}` },
        ...history,
        { role: 'user', content: userContent },
      ],
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta?.content
            if (delta) controller.enqueue(encoder.encode(delta))
          }
        } catch (e) {
          logError('api/copilot/answer/stream', e)
        } finally {
          controller.close()
        }
      },
    })
    return new Response(readable, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    logError('api/copilot/answer', e)
    return Response.json({ error: 'Assistant failed' }, { status: 502 })
  }
}
