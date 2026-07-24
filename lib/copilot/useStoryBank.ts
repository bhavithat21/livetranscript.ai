'use client'
import { useCallback, useEffect, useState } from 'react'

// Behavioral story-bank (Phase 3 RAG, the personalization moat). The user pastes
// their resume + STAR stories once; we chunk, embed (server route, existing key),
// and store the vectors ON THIS DEVICE (localStorage — the corpus is tiny, <~50
// chunks). At question time we brute-force cosine-match the transcript question
// to the best chunk and feed it to the behavioral answer — grounding the STAR
// reply in the user's REAL history instead of a generic invention.
//
// No vector DB: cosine over <50 vectors is microseconds. Privacy: the corpus
// never leaves the device except as text sent to the embed route (not persisted
// server-side).

const KEY = 'lt.storyBank'

export type StoryChunk = { text: string; embedding: number[] }

// Split pasted text into chunks: paragraph/blank-line separated, trimmed, deduped.
export function chunkCorpus(raw: string): string[] {
  return raw
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20) // skip trivial lines
    .slice(0, 100)
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch('/api/copilot/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ texts }),
  })
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to save your stories' : 'Embedding failed')
  const { embeddings } = await res.json()
  return embeddings
}

export function useStoryBank() {
  const [chunks, setChunks] = useState<StoryChunk[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) setChunks(JSON.parse(raw) as StoryChunk[])
    } catch {
      /* corrupt/absent — empty bank */
    }
  }, [])

  // Replace the bank: chunk the pasted text, embed, persist.
  const save = useCallback(async (raw: string) => {
    setError(null)
    const texts = chunkCorpus(raw)
    if (!texts.length) {
      setError('Paste your resume or a few STAR stories first')
      return
    }
    setSaving(true)
    try {
      const vectors = await embed(texts)
      const next = texts.map((text, i) => ({ text, embedding: vectors[i] }))
      setChunks(next)
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage full — kept in memory this session */
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save stories')
    } finally {
      setSaving(false)
    }
  }, [])

  const clear = useCallback(() => {
    setChunks([])
    try {
      localStorage.removeItem(KEY)
    } catch {
      /* ignore */
    }
  }, [])

  // Best-matching story chunk for a question. Embeds the query, cosine-ranks the
  // bank, returns the top text if it clears the similarity floor (else null →
  // the answer refuses to fabricate rather than force a bad match).
  const retrieve = useCallback(
    async (question: string, minScore = 0.2): Promise<string | null> => {
      if (!chunks.length || !question.trim()) return null
      try {
        const [q] = await embed([question])
        let best: StoryChunk | null = null
        let bestScore = -1
        for (const c of chunks) {
          const s = cosine(q, c.embedding)
          if (s > bestScore) {
            bestScore = s
            best = c
          }
        }
        return best && bestScore >= minScore ? best.text : null
      } catch {
        return null // retrieval is best-effort; answer still runs ungrounded-but-honest
      }
    },
    [chunks],
  )

  return { count: chunks.length, saving, error, save, clear, retrieve }
}
