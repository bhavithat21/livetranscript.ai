'use client'
import { useCallback, useEffect, useState } from 'react'

// Per-mode "context": documents (uploaded files or pasted text, chunked +
// embedded) plus free-text instructions for HOW that mode's chat should answer.
// Generalizes the old behavioral-only story-bank to all four modes, each with
// its OWN context — separate documents/instructions for coding vs behavioral
// vs general vs system design, matching the fact each mode already keeps its
// own separate chat thread (useCopilot filters turns by mode).
//
// Same privacy/infra posture as the story-bank it replaces: chunks are embedded
// via the existing /api/copilot/embed route (no new key) and the vectors live
// ON THIS DEVICE (localStorage, keyed per mode) — no vector DB, nothing new
// persisted server-side.

export type StoryChunk = { text: string; embedding: number[] }
export type ContextDoc = { id: string; name: string; chunks: StoryChunk[] }
type Persisted = { instructions: string; docs: ContextDoc[] }

const MAX_DOCS = 20
const MAX_INSTRUCTIONS = 4_000

function keyFor(mode: string): string {
  return `lt.context.${mode}`
}

// Split text into chunks: paragraph/blank-line separated, trimmed, deduped.
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
  if (!res.ok) throw new Error(res.status === 401 ? 'Sign in to add context' : 'Embedding failed')
  const { embeddings } = await res.json()
  return embeddings
}

function load(mode: string): Persisted {
  try {
    const raw = localStorage.getItem(keyFor(mode))
    if (!raw) return { instructions: '', docs: [] }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return { instructions: parsed.instructions ?? '', docs: parsed.docs ?? [] }
  } catch {
    return { instructions: '', docs: [] } // corrupt/absent — empty context
  }
}

function persist(mode: string, data: Persisted) {
  try {
    localStorage.setItem(keyFor(mode), JSON.stringify(data))
  } catch {
    /* storage full — kept in memory this session */
  }
}

export function useModeContext(mode: string) {
  const [docs, setDocs] = useState<ContextDoc[]>([])
  const [instructions, setInstructionsState] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Each mode has its OWN context — reload whenever the active mode changes.
  useEffect(() => {
    const data = load(mode)
    setDocs(data.docs)
    setInstructionsState(data.instructions)
    setError(null)
  }, [mode])

  const setInstructions = useCallback(
    (text: string) => {
      const capped = text.slice(0, MAX_INSTRUCTIONS)
      setInstructionsState(capped)
      persist(mode, { instructions: capped, docs })
    },
    [mode, docs],
  )

  // Chunk + embed a document's raw text and add it to this mode's context.
  const addDocument = useCallback(
    async (name: string, raw: string) => {
      setError(null)
      if (docs.length >= MAX_DOCS) {
        setError(`Up to ${MAX_DOCS} documents per mode`)
        return
      }
      const texts = chunkCorpus(raw)
      if (!texts.length) {
        setError(`${name || 'That document'} has no usable text`)
        return
      }
      setSaving(true)
      try {
        const vectors = await embed(texts)
        const chunks = texts.map((text, i) => ({ text, embedding: vectors[i] }))
        const doc: ContextDoc = { id: crypto.randomUUID(), name: name || 'Untitled', chunks }
        const next = [...docs, doc]
        setDocs(next)
        persist(mode, { instructions, docs: next })
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add document')
      } finally {
        setSaving(false)
      }
    },
    [mode, docs, instructions],
  )

  const removeDocument = useCallback(
    (id: string) => {
      const next = docs.filter((d) => d.id !== id)
      setDocs(next)
      persist(mode, { instructions, docs: next })
    },
    [mode, docs, instructions],
  )

  const clear = useCallback(() => {
    setDocs([])
    setInstructionsState('')
    try {
      localStorage.removeItem(keyFor(mode))
    } catch {
      /* ignore */
    }
  }, [mode])

  const chunkCount = docs.reduce((n, d) => n + d.chunks.length, 0)

  // Best-matching chunk across every document in this mode's context. Embeds
  // the query, cosine-ranks all chunks, returns the top text if it clears the
  // similarity floor (else null — the answer stays honest rather than forcing
  // a bad match).
  const retrieve = useCallback(
    async (question: string, minScore = 0.2): Promise<string | null> => {
      if (!chunkCount || !question.trim()) return null
      try {
        const [q] = await embed([question])
        let best: StoryChunk | null = null
        let bestScore = -1
        for (const doc of docs) {
          for (const c of doc.chunks) {
            const s = cosine(q, c.embedding)
            if (s > bestScore) {
              bestScore = s
              best = c
            }
          }
        }
        return best && bestScore >= minScore ? best.text : null
      } catch {
        return null // retrieval is best-effort; answer still runs ungrounded-but-honest
      }
    },
    [docs, chunkCount],
  )

  return {
    docs,
    instructions,
    count: chunkCount,
    saving,
    error,
    setInstructions,
    addDocument,
    removeDocument,
    clear,
    retrieve,
  }
}
