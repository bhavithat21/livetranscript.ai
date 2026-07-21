import { describe, it, expect } from 'vitest'
import { alignIndex, syllables, bandWordCount, sourceKeyterms, wordState } from './shadowAlign'

const SRC = 'The quick brown fox jumps over the lazy dog'.split(' ')

describe('alignIndex', () => {
  it('is 0 before anything is spoken', () => {
    expect(alignIndex(SRC, '')).toBe(0)
  })

  it('advances to the word after what has been spoken', () => {
    expect(alignIndex(SRC, 'the quick brown')).toBe(3) // next word = 'fox' at index 3
  })

  it('ignores punctuation and casing', () => {
    expect(alignIndex(SRC, 'THE, quick! brown.')).toBe(3)
  })

  it('tolerates a skipped/dropped word within the window', () => {
    // repeater skipped 'quick' — should still land past 'brown'
    expect(alignIndex(SRC, 'the brown')).toBe(3)
  })

  it('does not exceed the source length', () => {
    expect(alignIndex(SRC, 'the quick brown fox jumps over the lazy dog extra words')).toBe(SRC.length)
  })

  it('stays put when the spoken text does not match ahead', () => {
    // gibberish beyond the skip window keeps the cursor where it was
    expect(alignIndex(SRC, 'the quick zzz yyy xxx www')).toBe(2)
  })
})

describe('syllables', () => {
  it('estimates common words', () => {
    expect(syllables('the')).toBe(1)
    expect(syllables('system')).toBe(2)
    expect(syllables('internationalization')).toBeGreaterThanOrEqual(7)
    expect(syllables('code')).toBe(1) // silent trailing e
  })
})

describe('bandWordCount (adaptive)', () => {
  it('covers more short words than long words for the same speaking time', () => {
    const shortWords = 'the way we can do it now'.split(' ') // all 1 syllable
    const longWords = 'internationalization happens rarely'.split(' ')
    const shortBand = bandWordCount(shortWords, 0)
    const longBand = bandWordCount(longWords, 0)
    expect(shortBand).toBeGreaterThan(longBand)
  })
  it('clamps to the 2–6 word range', () => {
    const words = 'a a a a a a a a a a'.split(' ') // all tiny
    expect(bandWordCount(words, 0)).toBeLessThanOrEqual(6)
    expect(bandWordCount(['a'], 0)).toBeGreaterThanOrEqual(1)
  })
})

describe('wordState (growing trail)', () => {
  // reader is on word 3, band spans 2 words (lead + 1 next)
  it('marks words behind as covered, the current as lead, the next as band', () => {
    expect(wordState(0, 3, 2)).toBe('covered')
    expect(wordState(2, 3, 2)).toBe('covered')
    expect(wordState(3, 3, 2)).toBe('lead')
    expect(wordState(4, 3, 2)).toBe('band') // within lead+2
    expect(wordState(5, 3, 2)).toBe('upcoming')
  })
  it('at the start everything ahead is band or upcoming, nothing covered', () => {
    expect(wordState(0, 0, 3)).toBe('lead')
    expect(wordState(1, 0, 3)).toBe('band')
    expect(wordState(9, 0, 3)).toBe('upcoming')
  })
})

describe('sourceKeyterms', () => {
  it('keeps content words, drops short/function words, dedupes', () => {
    const terms = sourceKeyterms('the service is by sharding the write path across regions')
    expect(terms).toContain('service')
    expect(terms).toContain('sharding')
    expect(terms).not.toContain('the') // < 4 chars
    expect(terms).not.toContain('is')
    // 'the' appears twice but is excluded; no dupes among kept terms
    expect(new Set(terms).size).toBe(terms.length)
  })
})
