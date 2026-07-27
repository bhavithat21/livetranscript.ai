import { describe, it, expect } from 'vitest'
import { mmrSelect } from './rerank'

// MMR must (1) return the most relevant item first, and (2) prefer a DIVERSE second
// pick over a near-duplicate of the first — that's the whole point vs plain top-k.
describe('mmrSelect', () => {
  // Query points along x. A == query (most relevant), A' is a near-EXACT duplicate
  // of A, B is meaningfully relevant but in a different direction (diverse), C is
  // irrelevant. This is the classic "top-k returns 3 copies of the same fact" setup.
  const query = [1, 0]
  const cands = [
    { item: 'A', embedding: [1, 0] }, // most relevant
    { item: "A'", embedding: [1, 0] }, // exact duplicate of A
    { item: 'B', embedding: [0.6, 0.8] }, // relevant but different direction
    { item: 'C', embedding: [0, 1] }, // irrelevant
  ]

  it('returns the single most relevant item first', () => {
    expect(mmrSelect(query, cands, 1)[0]).toBe('A')
  })

  it('never picks the near-duplicate of the top hit as #2 when diversity is weighted', () => {
    // The core MMR value: after A, a clone of A (A') is the WORST second pick, so it
    // must be excluded in favor of something that adds new information (B or C).
    const top2 = mmrSelect(query, cands, 2, 0.4)
    expect(top2[0]).toBe('A')
    expect(top2).not.toContain("A'")
    expect(top2[1] === 'B' || top2[1] === 'C').toBe(true) // some genuinely different chunk
  })

  it('with lambda=1 (pure relevance) it ignores diversity and takes the top-2 by score', () => {
    const top2 = mmrSelect(query, cands, 2, 1)
    // A and A' are tied at the top cosine, so pure relevance keeps both.
    expect(top2).toEqual(['A', "A'"])
  })

  it('never returns more than k or more than the candidate pool', () => {
    expect(mmrSelect(query, cands, 10)).toHaveLength(4)
    expect(mmrSelect(query, [], 3)).toEqual([])
  })
})
