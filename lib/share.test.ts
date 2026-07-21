import { describe, it, expect } from 'vitest'
import { isShareValid } from './share'

const now = 1_000_000
describe('isShareValid', () => {
  it('false when no token', () => {
    expect(isShareValid({ shareToken: null, shareExpiresAt: new Date(now + 1000) }, now)).toBe(false)
  })
  it('false when expired', () => {
    expect(isShareValid({ shareToken: 'abc', shareExpiresAt: new Date(now - 1) }, now)).toBe(false)
  })
  it('true when token present and not expired', () => {
    expect(isShareValid({ shareToken: 'abc', shareExpiresAt: new Date(now + 1) }, now)).toBe(true)
  })
})
