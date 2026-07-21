import { describe, it, expect } from 'vitest'
import { newShareToken } from './schema'

describe('newShareToken', () => {
  it('is url-safe and 22 chars', () => {
    expect(newShareToken()).toMatch(/^[A-Za-z0-9_-]{22}$/)
  })
  it('is unique across calls', () => {
    expect(newShareToken()).not.toBe(newShareToken())
  })
})
