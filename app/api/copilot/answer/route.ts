import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'

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

// Match C0 control chars (0x00-0x1F) + DEL (0x7F), built without literal control
// chars in source so the file stays clean-editable.
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const SYSTEM = `You are the assistant inside LiveTranscript, shown beside a live transcript.
Answer the user's question using the TRANSCRIPT as your primary source — quote or
reference what was actually said when it's relevant. If the transcript doesn't
contain the answer, say so briefly ("That wasn't covered in the transcript") and
answer from general knowledge only if clearly helpful, labelled as such. Never
claim someone said something they didn't. Be concise and direct — this is a side
panel, not an essay. Use short markdown.`

// Collapse control chars to spaces (keeps normal text/whitespace) + cap. The
// transcript/question are untrusted input.
function clean(s: string, max: number): string {
  return s.replace(CONTROL_CHARS, ' ').slice(0, max)
}

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { question?: string; transcript?: string; history?: ChatTurn[] }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

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
    const stream = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      stream: true,
      temperature: 0.3, // factual, grounded answers
      messages: [
        // Stable prefix first (system + transcript) → prompt-cacheable across
        // follow-ups; the volatile question goes LAST.
        { role: 'system', content: SYSTEM },
        { role: 'system', content: `TRANSCRIPT (most recent):\n${transcript || '(empty so far)'}` },
        ...history,
        { role: 'user', content: question },
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
