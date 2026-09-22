import { NextRequest } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { modelForTier, vendorForModel, fastFallbackModel } from '@/lib/copilot/modes'
import { interviewPrompt, MAX_REQUEST_CHARS, parseInterviewRequest, type InterviewRequest } from '@/lib/interview/session'

export const maxDuration = 60

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const origin = req.headers.get('origin')
  if ((origin && origin !== new URL(req.url).origin) || req.headers.get('sec-fetch-site') === 'cross-site') {
    return Response.json({ error: 'Cross-origin interview requests are not allowed.' }, { status: 403 })
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_REQUEST_CHARS * 4) {
    return Response.json({ error: 'Interview request is too large.' }, { status: 413 })
  }
  let request: InterviewRequest
  try {
    const text = await req.text()
    if (text.length > MAX_REQUEST_CHARS) return Response.json({ error: 'Interview request is too large.' }, { status: 413 })
    request = parseInterviewRequest(JSON.parse(text))
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : error instanceof Error ? error.message : 'Invalid interview request.' }, { status: 400 })
  }
  const prompt = interviewPrompt(request)
  let model = modelForTier('smart')
  if (vendorForModel(model) === 'anthropic' && !process.env.ANTHROPIC_API_KEY) model = fastFallbackModel()
  const vendor = vendorForModel(model)
  const key = vendor === 'anthropic' ? process.env.ANTHROPIC_API_KEY : vendor === 'groq' ? process.env.GROQ_API_KEY : process.env.OPENAI_API_KEY
  if (!key) return Response.json({ error: 'Interview AI is not configured. Add a supported provider in the server environment.' }, { status: 503 })
  try {
    let text = ''
    const maxTokens = request.action === 'question' ? 1200 : 3000
    if (vendor === 'anthropic') {
      const client = new Anthropic({ apiKey: key, timeout: 45_000, maxRetries: 0 })
      const result = await client.messages.create({ model, max_tokens: maxTokens, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }, { signal: req.signal })
      text = result.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
    } else {
      const client = new OpenAI({ apiKey: key, baseURL: vendor === 'groq' ? 'https://api.groq.com/openai/v1' : undefined, timeout: 45_000, maxRetries: 0 })
      const result = await client.chat.completions.create({
        model: vendor === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
        max_tokens: maxTokens,
        messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: prompt.user }],
      }, { signal: req.signal })
      text = result.choices[0]?.message?.content ?? ''
    }
    text = text.trim()
    const maxLength = request.action === 'question' ? 6_000 : 40_000
    if (!text || text.length > maxLength) return Response.json({ error: 'The AI returned an invalid response. Please retry.' }, { status: 502 })
    return Response.json(request.action === 'question' ? { question: text } : { feedback: text }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    // Do not log transcript, role context, generated feedback, or raw provider errors.
    logError('api/interview', new Error(req.signal.aborted ? 'Interview request cancelled' : 'Interview provider request failed'))
    return Response.json({ error: 'Interview AI did not complete. Your answers are still available; please retry.' }, { status: 502 })
  }
}
