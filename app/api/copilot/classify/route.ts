import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { classifyQuestion } from '@/lib/copilot/serverClassifier'

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let body: unknown
  try { body = await req.json() }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const question = body && typeof body === 'object' && 'question' in body ? body.question : undefined
  if (typeof question !== 'string' || !question.trim()) return Response.json({ result: null })
  // Attempts reveal actual providers, latency and fallback without private input.
  return Response.json(await classifyQuestion(question, { signal: req.signal }))
}
