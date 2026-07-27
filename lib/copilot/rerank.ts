import { cosine } from './vector'

// Rerank retrieved chunks for quality. Plain cosine top-1 has two failure modes for
// a copilot: (1) it returns ONE chunk when an answer often needs a few, and (2) the
// top-k by raw similarity are frequently near-duplicates (the same fact three times)
// — wasted context that crowds out complementary material.
//
// MMR (Maximal Marginal Relevance) fixes both: it picks chunks that are relevant to
// the query BUT dissimilar to what's already picked, so the returned set covers more
// ground. Pure vector math — no extra API call, no key, no added latency. This is
// the dependency-free rerank; the upgrade path is a cross-encoder reranker (Voyage/
// Cohere) behind the same interface once a key is available.

export type Scored<T> = { item: T; embedding: number[]; relevance: number }

// Maximal Marginal Relevance selection. `lambda` trades relevance (1.0) vs diversity
// (0.0); 0.7 favors relevance while still de-duplicating. Returns up to `k` items in
// selection order (most relevant first).
export function mmrSelect<T>(
  query: number[],
  candidates: { item: T; embedding: number[] }[],
  k: number,
  lambda = 0.7,
): T[] {
  const scored = candidates.map((c) => ({ ...c, relevance: cosine(query, c.embedding) }))
  const selected: typeof scored = []
  const pool = [...scored]

  while (selected.length < k && pool.length > 0) {
    let bestIdx = 0
    let bestScore = -Infinity
    for (let i = 0; i < pool.length; i++) {
      // Penalty = the highest similarity of this candidate to anything already picked.
      let maxSimToSelected = 0
      for (const s of selected) {
        const sim = cosine(pool[i].embedding, s.embedding)
        if (sim > maxSimToSelected) maxSimToSelected = sim
      }
      const mmr = lambda * pool[i].relevance - (1 - lambda) * maxSimToSelected
      if (mmr > bestScore) {
        bestScore = mmr
        bestIdx = i
      }
    }
    selected.push(pool[bestIdx])
    pool.splice(bestIdx, 1)
  }
  return selected.map((s) => s.item)
}
