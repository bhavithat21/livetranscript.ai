import { describe, it, expect } from 'vitest'
import { recordUsage } from './usage'

// recordUsage must be fail-safe: metrics can never break a route. It's server-only
// (dynamic-imports posthog-node) and swallows everything. In the jsdom test env
// `window` is defined, so it early-returns — the contract we assert is "never throws".
describe('recordUsage', () => {
  it('never throws, even with odd input', () => {
    expect(() => recordUsage('answer', 'user_123', { mode: 'coding', model: 'claude-sonnet-5' })).not.toThrow()
    expect(() => recordUsage('execute', '', undefined)).not.toThrow()
    // @ts-expect-error — hostile input still must not throw
    expect(() => recordUsage(null, null, null)).not.toThrow()
  })
})
