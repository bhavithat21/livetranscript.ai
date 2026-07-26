import { describe, it, expect } from 'vitest'
import { rateLimit } from './rateLimit'

describe('rateLimit', () => {
  it('allows up to the limit then blocks within the window', () => {
    const key = 'test-' + Math.random()
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60_000)).toBe(true)
    expect(rateLimit(key, 5, 60_000)).toBe(false)
  })

  it('keeps separate buckets per key', () => {
    const a = 'a-' + Math.random()
    const b = 'b-' + Math.random()
    expect(rateLimit(a, 1, 60_000)).toBe(true)
    expect(rateLimit(a, 1, 60_000)).toBe(false)
    expect(rateLimit(b, 1, 60_000)).toBe(true)
  })
})
