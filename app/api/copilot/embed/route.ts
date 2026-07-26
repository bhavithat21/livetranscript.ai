import { NextRequest } from 'next/server'
import OpenAI from 'openai'
import { currentUserId } from '@/lib/auth'
import { logError } from '@/lib/log'
import { rateLimit } from '@/lib/rateLimit'

const EMBEDS_PER_MINUTE = 20

// Embeddings for the behavioral story-bank (Phase 3 RAG). The user's resume/STAR
// stories are chunked client-side and embedded here; vectors are stored in the
// browser (IndexedDB) and matched with brute-force cosine — no vector DB, no new
// key (same OPENAI_API_KEY). The server never persists the user's corpus.
//
// text-embedding-3-small: cheap, 1536-dim, one batched call for the whole corpus.

const MAX_TEXTS = 100
const MAX_CHARS = 8_000

export async function POST(req: NextRequest) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (!rateLimit(`embed:${userId}`, EMBEDS_PER_MINUTE, 60_000)) {
    return Response.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { texts?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const texts = Array.isArray(body.texts)
    ? body.texts
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .slice(0, MAX_TEXTS)
        .map((t) => t.slice(0, MAX_CHARS))
    : []
  if (!texts.length) return Response.json({ error: 'No texts to embed' }, { status: 400 })

  const key = process.env.OPENAI_API_KEY
  if (!key) return Response.json({ error: 'Embeddings unavailable' }, { status: 500 })

  try {
    const client = new OpenAI({ apiKey: key })
    const res = await client.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    })
    // Preserve input order so the caller can zip vectors back to their chunks.
    const embeddings = res.data.sort((a, b) => a.index - b.index).map((d) => d.embedding)
    return Response.json({ embeddings })
  } catch (e) {
    logError('api/copilot/embed', e)
    return Response.json({ error: 'Embedding failed' }, { status: 502 })
  }
}
