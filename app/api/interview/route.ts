import { NextResponse } from 'next/server'
import OpenAI from 'openai'
import { currentUserId, PREVIEW_USER_ID } from '@/lib/auth'
import { InterviewInputError, normalizeFeedback, parseInterviewRequest, parseMockQuestion } from '@/lib/interview/model'
import { interviewPrompt } from '@/lib/interview/prompts'
import { readInterviewBody } from '@/lib/interview/readBody'

export const runtime = 'nodejs'
export const maxDuration = 60
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { 'Cache-Control': 'no-store' },
})

export async function POST(request: Request) {
  // Same-origin browser requests only. No transcript is passed in a URL or log.
  if (request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Cross-origin requests are not allowed.' }, 403)
  let userId: string | null
  try { userId = await currentUserId() }
  catch { return json({ error: 'Sign in to use interview AI.' }, 401) }
  if (!userId || userId === PREVIEW_USER_ID) return json({ error: 'Sign in to use interview AI.' }, 401)
  let input
  try { input = parseInterviewRequest(await readInterviewBody(request)) }
  catch (error) {
    return json({ error: error instanceof InterviewInputError ? error.message : 'Invalid interview request.' }, 400)
  }
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return json({ error: 'Interview AI is not configured. Your transcript is still available to export.' }, 503)
  try {
    const client = new OpenAI({ apiKey, maxRetries: 0, timeout: 45_000 })
    const completion = await client.chat.completions.create({
      model: process.env.INTERVIEW_MODEL || 'gpt-4o-mini',
      response_format: { type: 'json_object' },
      max_completion_tokens: input.action === 'feedback' ? 5000 : 650,
      messages: [
        { role: 'system', content: interviewPrompt(input) },
        { role: 'user', content: JSON.stringify({ mode: input.mode, settings: input.settings, turns: input.turns }) },
      ],
    }, { signal: request.signal })
    const message = completion.choices[0]
    if (message?.finish_reason !== 'stop' || message.message.refusal) return json({ error: 'Interview AI did not complete its response. Retry; your transcript has not changed.' }, 502)
    const result: unknown = JSON.parse(message.message.content || '{}')
    return input.action === 'question'
      ? json({ question: parseMockQuestion(result, input.turns) })
      : json({ feedback: normalizeFeedback(result, input.turns) })
  } catch {
    // SDK exceptions can contain request data; do not send them to analytics/logs.
    return json({ error: 'Interview AI is temporarily unavailable. Retry or export your transcript.' }, 502)
  }
}
