import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'

const MAX_TEXT = 4_000
const MAX_TERMS = 40
const MAX_TERM_LEN = 80

// Strip anything that could steer the prompt: newlines/control chars, and cap
// count + length so keyterms stay a plain domain-word list (S5 injection guard).
function sanitizeKeyterms(raw: unknown): string {
  if (!Array.isArray(raw)) return 'none'
  const clean = raw
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.replace(/[\r\n\t]+/g, ' ').replace(/[^\p{L}\p{N} .+#/_-]/gu, '').trim().slice(0, MAX_TERM_LEN))
    .filter(Boolean)
    .slice(0, MAX_TERMS)
  return clean.length ? clean.join(', ') : 'none'
}

// Correction track: cleans a finalized live-transcript line using recent context + keyterms.
// Fail-soft — on any error, echoes the original text so the live line is never lost or blanked.
export async function POST(req: NextRequest) {
  // Require a signed-in user so anonymous callers can't drain OpenAI quota.
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { text?: string; context?: string; keyterms?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const text = body.text?.trim().slice(0, MAX_TEXT)
  if (!text) return NextResponse.json({ error: 'Empty text' }, { status: 400 })

  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ text }) // fail-soft: keep live line

  try {
    const client = new OpenAI({ apiKey: key })
    const terms = sanitizeKeyterms(body.keyterms)
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Correct transcription errors in the user's line: fix homophones, punctuation, capitalization, and misheard technical jargon. Preserve meaning and speaker wording — do NOT paraphrase or add content. Domain terms that may appear: ${terms || 'none'}. Respond ONLY with JSON: {"text": string}.`,
        },
        {
          role: 'user',
          content: `Recent context: ${(body.context ?? '').slice(0, MAX_TEXT)}\n\nLine to correct: ${text}`,
        },
      ],
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)
    return NextResponse.json({
      text: typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text : text,
    })
  } catch (e) {
    logError('api/correct', e) // fail-soft below, but the failure is still recorded
    return NextResponse.json({ text }) // never lose or blank the live line
  }
}
