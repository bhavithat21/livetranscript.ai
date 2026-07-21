import { describe, it, expect } from 'vitest'
import { alignIndex } from './shadowAlign'

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
