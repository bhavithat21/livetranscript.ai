import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { fastFallbackModel, vendorForModel } from '@/lib/copilot/modes'
import OpenAI from 'openai'

// Fast question CLASSIFIER — the "orchestrator" brain. One cheap call answers the two
// things the copilot needs to route a heard question:
//   - mode:      general | coding | systemDesign | behavioral  (auto-switch the tab)
//   - needsWeb:  does answering correctly need CURRENT facts the model may not know?
//   - isQuestion:is this actually a question worth answering (vs chatter)?
// Runs on the fast tier (Groq) with a tiny JSON output so it adds minimal latency
// before the real answer. Fail-soft: on any error the caller keeps its current mode
// and skips web search, so classification can never block an answer.

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1'
const MAX_Q = 1_000

const SYSTEM = `You classify an interview question for a copilot. Reply with ONLY compact JSON, no prose:
{"isQuestion": bool, "mode": "general"|"coding"|"systemDesign"|"behavioral", "needsWeb": bool, "confidence": 0..1}
- mode: "coding" = write/debug an algorithm or code. "systemDesign" = design a system/architecture at scale. "behavioral" = "tell me about a time", leadership, conflict, teamwork. "general" = anything else / small talk / factual.
- needsWeb: true ONLY if a correct answer needs CURRENT facts a 2024-trained model would get wrong — latest versions, recent events, prices, "as of now/today/this year". false for timeless CS/behavioral.
- isQuestion: false for statements, filler, or the candidate's own answer; true for a real asked question.
- confidence: your certainty in mode.`

const VALID_MODES = new Set(['general', 'coding', 'systemDesign', 'behavioral'])

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // Classifier runs on the fast tier; if that vendor's key is missing, no-op so the
  // caller falls back to its manual mode + no web search.
  const model = fastFallbackModel()
  const vendor = vendorForModel(model)
  const groqKey = process.env.GROQ_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY
  if ((vendor === 'groq' && !groqKey) || (vendor === 'openai' && !openaiKey)) {
    return Response.json({ result: null })
  }

  let body: { question?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const question = typeof body.question === 'string' ? body.question.trim().slice(0, MAX_Q) : ''
  if (!question) return Response.json({ result: null })

  try {
    // Prefer Groq (fastest); else OpenAI. Anthropic isn't used here — a JSON micro-call
    // doesn't need it, and the fast tier keeps classification latency negligible.
    const client =
      vendor === 'groq'
        ? new OpenAI({ apiKey: groqKey, baseURL: GROQ_BASE_URL, maxRetries: 0, timeout: 8_000 })
        : new OpenAI({ apiKey: openaiKey, maxRetries: 0, timeout: 8_000 })
    const resp = await client.chat.completions.create({
      model: vendor === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 80,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: question },
      ],
    })
    const raw = resp.choices[0]?.message?.content ?? ''
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const mode = typeof parsed.mode === 'string' && VALID_MODES.has(parsed.mode) ? parsed.mode : 'general'
    return Response.json({
      result: {
        isQuestion: parsed.isQuestion !== false,
        mode,
        needsWeb: parsed.needsWeb === true,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      },
    })
  } catch (e) {
    logError('api/copilot/classify', e)
    return Response.json({ result: null }) // fail-soft: caller keeps manual mode, no web
  }
}
