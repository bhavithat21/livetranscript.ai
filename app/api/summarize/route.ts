import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { rateLimit } from '@/lib/rateLimit'
import { normalizeSummary } from '@/lib/summary'

// ponytail: same per-user in-memory limiter as /api/ably-token. The sibling AI
// routes (copilot/answer, correct, copilot/embed) still guard only on auth and
// should get the same limiter — owned by other agents, tracked as follow-up.
const SUMMARIES_PER_MINUTE = 10

export async function POST(req: NextRequest) {
  // Require a signed-in user so anonymous callers can't drain OpenAI quota.
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Bounded per-user rate so one account can't loop the route and drain quota.
  if (!rateLimit(`summarize:${userId}`, SUMMARIES_PER_MINUTE, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { transcript?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const transcript = body.transcript?.trim()
  if (!transcript) return NextResponse.json({ error: 'Empty transcript' }, { status: 400 })

  const key = process.env.OPENAI_API_KEY
  if (!key) return NextResponse.json({ error: 'Summaries unavailable' }, { status: 500 })
  const client = new OpenAI({ apiKey: key })

  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You summarize transcripts. Respond ONLY with JSON: {"summary": string, "keyPoints": string[], "actionItems": string[]}.',
        },
        { role: 'user', content: transcript.slice(0, 100_000) },
      ],
      response_format: { type: 'json_object' },
    })
    const raw = completion.choices[0]?.message?.content ?? '{}'
    // The LLM can return the wrong shape or non-string array elements; normalize
    // so the client and DB always get {summary, keyPoints:string[], actionItems:string[]}.
    const summary = normalizeSummary(JSON.parse(raw))
    return NextResponse.json(summary ?? { summary: '', keyPoints: [], actionItems: [] })
  } catch (e) {
    logError('api/summarize', e)
    return NextResponse.json({ error: 'Summary generation failed' }, { status: 502 })
  }
}
