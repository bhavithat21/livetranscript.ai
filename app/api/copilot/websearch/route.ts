import { NextRequest } from 'next/server'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { recordUsage } from '@/lib/usage'

// Live web search via Gemini's native Google Search grounding — REAL browsing, not
// the model's trained knowledge. Used to ground answers whose correctness depends on
// current facts (latest version, recent event, "as of now") that a training-cutoff
// model would get confidently wrong. Reuses the existing GEMINI_API_KEY (no new key).
//
// Returns a compact, source-attributed snippet the answer route injects as context —
// NOT a full answer. The main copilot model still writes the answer, grounded in this.

const GEMINI_SEARCH_MODEL = process.env.COPILOT_MODEL_SEARCH || 'gemini-flash-latest'
const GEMINI_URL = (m: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`
const MAX_QUERY = 2_000

type GroundingChunk = { web?: { title?: string; uri?: string } }

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const key = process.env.GEMINI_API_KEY
  if (!key) return Response.json({ result: null }) // no key → gracefully no web context

  let body: { query?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const query = typeof body.query === 'string' ? body.query.trim().slice(0, MAX_QUERY) : ''
  if (!query) return Response.json({ result: null })

  try {
    const res = await fetch(GEMINI_URL(GEMINI_SEARCH_MODEL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `Search the web and give the current, factual answer with specifics: ${query}` }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(12_000), // fast: this is a grounding hop, not the answer
    })
    if (!res.ok) return Response.json({ result: null }) // fail-soft: answer proceeds ungrounded-by-web
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; groundingMetadata?: { groundingChunks?: GroundingChunk[] } }[]
    }
    const cand = json.candidates?.[0]
    const text = cand?.content?.parts?.map((p) => p.text).filter(Boolean).join(' ').trim()
    if (!text) return Response.json({ result: null })
    // Attach up to 3 source titles/URLs so the answer can cite where facts came from.
    const sources = (cand?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web)
      .filter((w): w is { title?: string; uri?: string } => !!w)
      .slice(0, 3)
      .map((w) => `${w.title ?? 'source'}${w.uri ? ` (${w.uri})` : ''}`)
    recordUsage('websearch', userId, { grounded: sources.length })
    const result = sources.length ? `${text}\n\nSources: ${sources.join('; ')}` : text
    return Response.json({ result })
  } catch (e) {
    logError('api/copilot/websearch', e)
    return Response.json({ result: null }) // never block the answer on a search failure
  }
}
