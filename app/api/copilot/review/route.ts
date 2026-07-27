import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { recordUsage } from '@/lib/usage'
import { modelForTier, vendorForModel, fastFallbackModel } from '@/lib/copilot/modes'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

// Post-interview REVIEW. Takes the questions asked (with their auto-classified mode)
// + the transcript, and returns a structured recap: what was covered, which Amazon
// Leadership Principles the behavioral answers touched, and concrete gaps / things to
// tighten. Reuses the existing model plumbing; smart tier for a thoughtful recap.

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const MAX_TRANSCRIPT = 40_000
const MAX_QUESTIONS = 40

const SYSTEM = `You are an interview coach reviewing a candidate's practice/interview session. You are given the QUESTIONS asked (with detected type) and the TRANSCRIPT. Produce a tight, honest debrief in markdown:

## Coverage
- Bullet the topics/questions covered, grouped by type (behavioral / coding / system design / general).

## Leadership Principles touched
- For behavioral answers, list which Amazon LPs the stories demonstrated (Ownership, Bias for Action, Dive Deep, Have Backbone, Deliver Results, Earn Trust, etc.). Note any commonly-asked LP that was NOT covered.

## What to tighten
- 3-5 specific, actionable notes: a vague answer, a missing metric, an "I vs we" slip, a coding edge case skipped, a design bottleneck not addressed. Be concrete and reference what was actually said.

## One thing to practice next
- The single highest-leverage fix.

Ground everything in the transcript — do not invent questions or claims that weren't there. Be direct and useful, not flattering.`

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { transcript?: string; questions?: { q: string; mode: string }[] }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const transcript = (body.transcript ?? '').slice(-MAX_TRANSCRIPT).trim()
  const questions = Array.isArray(body.questions) ? body.questions.slice(0, MAX_QUESTIONS) : []
  if (!transcript && !questions.length) return Response.json({ error: 'Nothing to review' }, { status: 400 })

  let model = modelForTier('smart')
  if (vendorForModel(model) === 'anthropic' && !process.env.ANTHROPIC_API_KEY) model = fastFallbackModel()

  const qList = questions.map((x, i) => `${i + 1}. [${x.mode}] ${x.q}`).join('\n')
  const userMsg = `QUESTIONS ASKED:\n${qList || '(none detected)'}\n\nTRANSCRIPT:\n${transcript || '(none)'}`

  try {
    let text = ''
    if (vendorForModel(model) === 'anthropic') {
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 40_000 })
      const r = await client.messages.create({
        model,
        max_tokens: 1500,
        system: SYSTEM,
        messages: [{ role: 'user', content: userMsg }],
      })
      text = r.content[0]?.type === 'text' ? r.content[0].text : ''
    } else {
      const isGroq = vendorForModel(model) === 'groq'
      const client = new OpenAI({
        apiKey: isGroq ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY,
        baseURL: isGroq ? GROQ_BASE_URL : undefined,
        maxRetries: 1,
        timeout: 40_000,
      })
      if (!client.apiKey) return Response.json({ error: 'Review unavailable' }, { status: 500 })
      const r = await client.chat.completions.create({
        model: isGroq ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
        max_tokens: 1500,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userMsg },
        ],
      })
      text = r.choices[0]?.message?.content ?? ''
    }
    if (!text.trim()) return Response.json({ error: 'Empty review' }, { status: 502 })
    recordUsage('review', userId, { questions: questions.length })
    return Response.json({ review: text })
  } catch (e) {
    logError('api/copilot/review', e)
    return Response.json({ error: 'Review failed' }, { status: 502 })
  }
}
