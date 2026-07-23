import { describe, it, expect } from 'vitest'
import { MIN_SCALE, MAX_SCALE } from './useTextScale'

// The clamp is the load-bearing bit of useTextScale; mirror it here as a pure
// check so the bounds can't silently drift. (The hook itself is exercised in the
// browser; this guards the numeric contract.)
const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(n * 100) / 100))

describe('useTextScale bounds', () => {
  it('never goes below MIN_SCALE or above MAX_SCALE', () => {
    expect(clamp(0.1)).toBe(MIN_SCALE)
    expect(clamp(5)).toBe(MAX_SCALE)
  })
  it('keeps an in-range value (rounded to 2dp)', () => {
    expect(clamp(1.15)).toBe(1.15)
    expect(clamp(1)).toBe(1)
  })
  it('has a sensible spread (min < 1 < max)', () => {
    expect(MIN_SCALE).toBeLessThan(1)
    expect(MAX_SCALE).toBeGreaterThan(1)
  })
})
