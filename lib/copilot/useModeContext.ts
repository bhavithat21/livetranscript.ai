'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

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

import { parseStoryBook, looksLikeStoryBook } from './storyBook'

export type StoryChunk = { text: string; embedding: number[] }
export type ContextDoc = { id: string; name: string; chunks: StoryChunk[] }
// A whole story from an uploaded story book (behavioral mode): the retrieval key is
// embedded to match a question; fullText is fed to the model to answer. Kept
// separate from generic chunks so we can rank + spend STORIES, not paragraphs.
export type StoryEntry = { id: string; title: string; embedding: number[]; fullText: string }
type Persisted = { instructions: string; docs: ContextDoc[]; stories?: StoryEntry[] }

const MAX_DOCS = 20
const MAX_INSTRUCTIONS = 4_000
// Matches the embed route's MAX_TEXTS (100): more stories than that would get
// fewer vectors than entries and poison retrieval with undefined embeddings.
const MAX_STORIES = 100

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
    if (!raw) return { instructions: '', docs: [], stories: [] }
    const parsed = JSON.parse(raw) as Partial<Persisted>
    return { instructions: parsed.instructions ?? '', docs: parsed.docs ?? [], stories: parsed.stories ?? [] }
  } catch {
    return { instructions: '', docs: [], stories: [] } // corrupt/absent — empty context
  }
}

// Returns false if the write failed (e.g. localStorage quota — embeddings are
// large). Caller warns the user their context won't survive a reload, instead of
// silently dropping it (false confidence in a live interview).
function persist(mode: string, data: Persisted): boolean {
  try {
    localStorage.setItem(keyFor(mode), JSON.stringify(data))
    return true
  } catch {
    return false // storage full — kept in memory this session only
  }
}

export function useModeContext(mode: string) {
  const [docs, setDocs] = useState<ContextDoc[]>([])
  const [stories, setStories] = useState<StoryEntry[]>([])
  const [instructions, setInstructionsState] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Stories already USED this round — spent once, per the book's rule. Session-only
  // (a ref, not persisted): a new interview round starts fresh. resetSpent() clears it.
  const spentRef = useRef<Set<string>>(new Set())

  // Each mode has its OWN context — reload whenever the active mode changes.
  useEffect(() => {
    const data = load(mode)
    setDocs(data.docs)
    setStories(data.stories ?? [])
    setInstructionsState(data.instructions)
    setError(null)
  }, [mode])

  const setInstructions = useCallback(
    (text: string) => {
      const capped = text.slice(0, MAX_INSTRUCTIONS)
      setInstructionsState(capped)
      persist(mode, { instructions: capped, docs, stories })
    },
    [mode, docs, stories],
  )

  // Add a document. A structured STORY BOOK (behavioral mode) is parsed into whole
  // stories, each embedded on its selector key (title + LPs + use-when + spine) so a
  // question can pick the right story. Anything else is chunked per-paragraph as
  // before. A book uploaded outside behavioral mode still parses — the stories just
  // live in that mode's context.
  const addDocument = useCallback(
    async (name: string, raw: string) => {
      setError(null)
      if (docs.length >= MAX_DOCS) {
        setError(`Up to ${MAX_DOCS} documents per mode`)
        return
      }
      setSaving(true)
      try {
        if (looksLikeStoryBook(raw)) {
          // A story book only grounds answers in BEHAVIORAL mode (retrieveStories is
          // behavioral-only). Uploaded elsewhere it'd be silent dead weight, so warn.
          if (mode !== 'behavioral') {
            setError('Story books are used in Behavioral mode — switch to Behavioral, then upload.')
            return
          }
          // Cap to the embed route's MAX_TEXTS: it slices input to 100, so a bigger
          // book would get FEWER vectors than stories → undefined embeddings →
          // cosine() throws → the whole bank silently returns nothing. Cap here so
          // every kept story has a real vector.
          const parsed = parseStoryBook(raw).slice(0, MAX_STORIES)
          if (!parsed.length) {
            setError(`${name || 'That story book'} had no recognizable stories`)
            return
          }
          // Embed each story's SELECTOR KEY (not its full prose) so ranking matches
          // the question to the right story, per the book's own "sounds like" table.
          const vectors = await embed(parsed.map((s) => s.retrievalKey))
          // Defensive: drop any story that didn't get a valid vector back, so a
          // short embed response can never poison retrieval with an undefined.
          const newStories: StoryEntry[] = parsed
            .map((s, i) => ({ id: s.id, title: s.title, embedding: vectors[i], fullText: s.fullText }))
            .filter((s) => Array.isArray(s.embedding) && s.embedding.length > 0)
          if (!newStories.length) {
            setError('Could not embed the story book — try again')
            return
          }
          // A book replaces the prior book (re-upload = refresh), and also drops it in
          // as a doc entry so the UI shows "1 doc" + the count.
          const doc: ContextDoc = { id: crypto.randomUUID(), name: name || 'Story book', chunks: [] }
          const nextDocs = [...docs, doc]
          spentRef.current = new Set() // fresh book → nothing spent yet
          setStories(newStories)
          setDocs(nextDocs)
          if (!persist(mode, { instructions, docs: nextDocs, stories: newStories })) {
            setError('Story book loaded, but too large to save — it won’t survive a page reload.')
          }
          return
        }
        const texts = chunkCorpus(raw)
        if (!texts.length) {
          setError(`${name || 'That document'} has no usable text`)
          return
        }
        const vectors = await embed(texts)
        const chunks = texts.map((text, i) => ({ text, embedding: vectors[i] })).filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
        const doc: ContextDoc = { id: crypto.randomUUID(), name: name || 'Untitled', chunks }
        const next = [...docs, doc]
        setDocs(next)
        if (!persist(mode, { instructions, docs: next, stories })) {
          setError('Document loaded, but too large to save — it won’t survive a page reload.')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add document')
      } finally {
        setSaving(false)
      }
    },
    [mode, docs, instructions, stories],
  )

  const removeDocument = useCallback(
    (id: string) => {
      const next = docs.filter((d) => d.id !== id)
      // Removing the last doc also clears any parsed stories (they came from a book).
      const nextStories = next.length ? stories : []
      setDocs(next)
      setStories(nextStories)
      persist(mode, { instructions, docs: next, stories: nextStories })
    },
    [mode, docs, stories, instructions],
  )

  const clear = useCallback(() => {
    setDocs([])
    setStories([])
    spentRef.current = new Set()
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

  // Pick the best UNSPENT stories for a question and mark them spent — the book's
  // core rule: a round needs 2 stories, each story spent once. Ranks all unspent
  // stories by cosine of the question against their selector key, returns the top
  // `n` (distinct), and records them as spent so the next question picks different
  // ones. Returns [] if there's no story book or the bank is exhausted.
  const retrieveStories = useCallback(
    async (question: string, n = 2): Promise<{ title: string; fullText: string }[]> => {
      if (!stories.length || !question.trim()) return []
      try {
        const [q] = await embed([question])
        const ranked = stories
          .filter((s) => !spentRef.current.has(s.id))
          .map((s) => ({ s, score: cosine(q, s.embedding) }))
          .sort((a, b) => b.score - a.score)
          .slice(0, n)
        if (!ranked.length) return [] // every story already spent this round
        for (const { s } of ranked) spentRef.current.add(s.id)
        return ranked.map(({ s }) => ({ title: s.title, fullText: s.fullText }))
      } catch {
        return []
      }
    },
    [stories],
  )

  // Start a fresh round — every story becomes available again.
  const resetSpent = useCallback(() => {
    spentRef.current = new Set()
  }, [])

  return {
    docs,
    instructions,
    count: chunkCount,
    storyCount: stories.length,
    saving,
    error,
    setInstructions,
    addDocument,
    removeDocument,
    clear,
    retrieve,
    retrieveStories,
    resetSpent,
  }
}
