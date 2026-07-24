import { describe, it, expect } from 'vitest'
import { cosine, chunkCorpus } from './useStoryBank'

describe('cosine', () => {
  it('is 1 for identical vectors, 0 for orthogonal', () => {
    expect(cosine([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
    expect(cosine([1, 0, 0], [0, 1, 0])).toBeCloseTo(0)
  })
  it('ranks a closer vector higher', () => {
    const q = [1, 1, 0]
    expect(cosine(q, [1, 1, 0])).toBeGreaterThan(cosine(q, [1, 0, 0]))
  })
  it('handles a zero vector without NaN', () => {
    expect(cosine([0, 0, 0], [1, 2, 3])).toBe(0)
  })
})

describe('chunkCorpus', () => {
  it('splits on blank lines and drops trivial fragments', () => {
    const raw =
      'A meaningful story about leading a migration under deadline.\n\nAnother story about resolving a stakeholder conflict.\n\nok'
    const chunks = chunkCorpus(raw)
    expect(chunks).toHaveLength(2) // "ok" is < 20 chars, dropped
    expect(chunks[0]).toMatch(/migration/)
  })
})
