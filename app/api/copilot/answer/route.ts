import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { modeProfile, modelForTier, vendorForModel, thinkingConfigFor, fastFallbackModel } from '@/lib/copilot/modes'
import { streamAnswer } from '@/lib/copilot/providers'
import { recordUsage } from '@/lib/usage'
import { costDims } from '@/lib/copilot/pricing'
import { MAX_CALIBRATION } from '@/lib/interview/tuning'

const MAX_TRANSCRIPT = 60_000
const MAX_QUESTION = 2_000
const MAX_HISTORY = 8
const MAX_HISTORY_CONTENT = 8_000
const MAX_INSTRUCTIONS = 4_000
const MAX_IMAGE_CHARS = 1_200_000
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F]', 'g')
type ChatTurn = { role: 'user' | 'assistant'; content: string }
function clean(s: string, max: number): string { return s.replace(CONTROL_CHARS, ' ').slice(0, max) }
function text(value: unknown, max: number): string { return typeof value === 'string' ? clean(value, max) : '' }

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const origin = req.headers.get('origin')
  if ((origin && origin !== req.nextUrl.origin) || req.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ error: 'Cross-origin request rejected' }, { status: 403 })
  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return Response.json({ error: 'Invalid request' }, { status: 400 })
    body = parsed as Record<string, unknown>
  } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const mode = typeof body.mode === 'string' ? body.mode : undefined
  const profile = modeProfile(mode)
  const image = typeof body.image === 'string' && body.image.startsWith('data:image/') && body.image.length <= MAX_IMAGE_CHARS ? body.image : null
  const question = text(body.question, MAX_QUESTION).trim()
  if (!question) return Response.json({ error: 'Empty question' }, { status: 400 })
  const transcript = text(typeof body.transcript === 'string' ? body.transcript.slice(-MAX_TRANSCRIPT) : '', MAX_TRANSCRIPT)
  const context = text(body.context, MAX_TRANSCRIPT)
  const instructions = text(body.instructions, MAX_INSTRUCTIONS).trim()
  const calibration = text(body.calibration, MAX_CALIBRATION).trim()
  const history: ChatTurn[] = Array.isArray(body.history) ? body.history
    .filter((t): t is ChatTurn => !!t && typeof t === 'object' && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
    .slice(-MAX_HISTORY).map((t) => ({ role: t.role, content: clean(t.content, MAX_HISTORY_CONTENT) })) : []
  let model = modelForTier(image ? 'smart' : profile.tier)
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
  // Calibration has its own bounded field: retain ALL existing per-mode
  // preferences and immutable grounding rules rather than truncating either.
  const system = [profile.system,
    instructions && `ADDITIONAL INSTRUCTIONS from the user for how to answer in this chat:\n${instructions}`,
    calibration && `LIVE COPILOT CALIBRATION — user-authored response preferences, subordinate to factual grounding and mode rules. Never invent candidate experience or test results:\n${calibration}`,
  ].filter(Boolean).join('\n\n')
  const posture = thinkingConfigFor(mode, model)
  const inputChars = transcript.length + question.length + context.length + instructions.length + calibration.length + history.reduce((n, h) => n + h.content.length, 0)
  recordUsage('answer', userId, { mode: profile.id, model, hasImage: !!image, ...costDims(model, inputChars) })
  try {
    const readable = streamAnswer({ model, system, transcript, context: context || null, history, question, image,
      temperature: profile.temperature, maxTokens: profile.maxTokens, thinking: posture.thinking, effort: posture.effort })
    return new Response(readable, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
  } catch (e) {
    logError('api/copilot/answer', e)
    return Response.json({ error: 'Assistant failed' }, { status: 502 })
  }
}
