import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

// Correction track: cleans a finalized live-transcript line using recent context + keyterms.
// Fail-soft — on any error, echoes the original text so the live line is never lost or blanked.
export async function POST(req: NextRequest) {
  let body: { text?: string; context?: string; keyterms?: string[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const text = body.text?.trim()
  if (!text) return NextResponse.json({ error: 'Empty text' }, { status: 400 })

  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ text }) // fail-soft: keep live line

  try {
    const client = new OpenAI({ apiKey: key })
    const terms = (body.keyterms ?? []).join(', ')
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `Correct transcription errors in the user's line: fix homophones, punctuation, capitalization, and misheard technical jargon. Preserve meaning and speaker wording — do NOT paraphrase or add content. Domain terms that may appear: ${terms || 'none'}. Respond ONLY with JSON: {"text": string}.`,
        },
        { role: 'user', content: `Recent context: ${body.context ?? ''}\n\nLine to correct: ${text}` },
      ],
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    const parsed = JSON.parse(raw)
    return NextResponse.json({
      text: typeof parsed.text === 'string' && parsed.text.trim() ? parsed.text : text,
    })
  } catch {
    return NextResponse.json({ text }) // fail-soft: never lose or blank the live line
  }
}
