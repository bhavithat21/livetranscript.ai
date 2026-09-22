'use client'
import { useCallback, useRef, useState } from 'react'
import { useStoredPreference } from '../browser/useStoredPreference'
import { cosine } from './vector'
import { mmrSelect } from './rerank'

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
type Persisted = { instructions: string; docs: ContextDoc[]; stories: StoryEntry[] }
const EMPTY_CONTEXT: Persisted = { instructions: '', docs: [], stories: [] }

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

// cosine now lives in ./vector (shared with the server embed route + rerank without
// an import cycle). Re-exported so existing importers of it from here keep working.
export { cosine }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every((n) => typeof n === 'number' && Number.isFinite(n))
}

function isChunk(value: unknown): value is StoryChunk {
  return isRecord(value) && typeof value.text === 'string' && isEmbedding(value.embedding)
}

function isStory(value: unknown): value is StoryEntry {
  return isRecord(value) && typeof value.id === 'string' && typeof value.title === 'string'
    && typeof value.fullText === 'string' && isEmbedding(value.embedding)
}

function parseContext(raw: string): Persisted {
  const parsed = JSON.parse(raw) as Partial<Persisted> | null
  const docs = Array.isArray(parsed?.docs) ? parsed.docs.flatMap((doc) => {
    if (!isRecord(doc) || typeof doc.id !== 'string' || typeof doc.name !== 'string' || !Array.isArray(doc.chunks)) return []
    return [{ id: doc.id, name: doc.name, chunks: doc.chunks.filter(isChunk) }]
  }).slice(0, MAX_DOCS) : []
  return {
    instructions: typeof parsed?.instructions === 'string' ? parsed.instructions.slice(0, MAX_INSTRUCTIONS) : '',
    docs,
    stories: Array.isArray(parsed?.stories) ? parsed.stories.filter(isStory).slice(0, MAX_STORIES) : [],
  }
}

export function useModeContext(mode: string) {
  const { value: { docs, stories, instructions }, setValue, clear: clearStored } = useStoredPreference(keyFor(mode), EMPTY_CONTEXT, parseContext)
  const [saving, setSaving] = useState(false)
  const [modeError, setModeError] = useState<{ mode: string; message: string | null } | null>(null)
  const error = modeError?.mode === mode ? modeError.message : null
  const setError = useCallback((message: string | null) => setModeError({ mode, message }), [mode])
  // Stories already USED this round — spent once, per the book's rule. Session-only
  // (a ref, not persisted): a new interview round starts fresh. resetSpent() clears it.
  const spentRef = useRef<Set<string>>(new Set())

  const setInstructions = useCallback(
    (text: string) => {
      const capped = text.slice(0, MAX_INSTRUCTIONS)
      const saved = setValue((current) => ({ ...current, instructions: capped }))
      setError(saved ? null : 'Instructions updated, but could not be saved — they won’t survive a page reload.')
    },
    [setValue, setError],
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
          spentRef.current = new Set() // fresh book → nothing spent yet
          if (!setValue((current) => ({ ...current, docs: [...current.docs, doc], stories: newStories }))) {
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
        if (!setValue((current) => ({ ...current, docs: [...current.docs, doc] }))) {
          setError('Document loaded, but too large to save — it won’t survive a page reload.')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not add document')
      } finally {
        setSaving(false)
      }
    },
    [mode, docs.length, setValue, setError],
  )

  const removeDocument = useCallback(
    (id: string) => {
      const saved = setValue((current) => {
        const next = current.docs.filter((d) => d.id !== id)
        // Removing the last doc also clears any parsed stories (they came from a book).
        return { ...current, docs: next, stories: next.length ? current.stories : [] }
      })
      setError(saved ? null : 'Could not save the removal — the document may return after a page reload.')
    },
    [setValue, setError],
  )

  const clear = useCallback(() => {
    spentRef.current = new Set()
    const saved = clearStored()
    setError(saved ? null : 'Could not clear saved context — it may return after a page reload.')
  }, [clearStored, setError])

  const chunkCount = docs.reduce((n, d) => n + d.chunks.length, 0)

  // Retrieve the most relevant context for a question. Was top-1 (one chunk); now
  // top-k with MMR rerank so the answer gets several COMPLEMENTARY chunks instead of
  // one (or three near-duplicates). Only chunks clearing the similarity floor are
  // eligible, so a bad match still yields null rather than forcing irrelevant text.
  const retrieve = useCallback(
    async (question: string, minScore = 0.2, k = 4): Promise<string | null> => {
      if (!chunkCount || !question.trim()) return null
      try {
        const [q] = await embed([question])
        // Candidates above the relevance floor, across every doc in this mode.
        const eligible = docs
          .flatMap((doc) => doc.chunks)
          .map((c) => ({ item: c.text, embedding: c.embedding, score: cosine(q, c.embedding) }))
          .filter((c) => c.score >= minScore)
        if (!eligible.length) return null
        // MMR picks relevant-but-diverse chunks; join with separators so the model
        // sees them as distinct snippets.
        const picked = mmrSelect(q, eligible, Math.min(k, eligible.length))
        return picked.join('\n\n— — —\n\n')
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
