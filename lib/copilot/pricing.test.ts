import { describe, it, expect } from 'vitest'
import { estimateCostUsd, costDims } from './pricing'

describe('pricing', () => {
  it('estimates a nonzero cost that scales with input size', () => {
    const small = estimateCostUsd('claude-sonnet-5', 400)
    const big = estimateCostUsd('claude-sonnet-5', 40_000)
    expect(small).toBeGreaterThan(0)
    expect(big).toBeGreaterThan(small)
  })

  it('prices a frontier model higher than a cheap open model for the same input', () => {
    const sonnet = estimateCostUsd('claude-sonnet-5', 10_000)
    const groq = estimateCostUsd('llama-3.3-70b-versatile', 10_000)
    expect(sonnet).toBeGreaterThan(groq)
  })

  it('falls back to a default price for an unknown model (never silently 0)', () => {
    expect(estimateCostUsd('some-future-model', 10_000)).toBeGreaterThan(0)
  })

  it('costDims carries vendor + input_chars + a rounded est_cost_usd', () => {
    const d = costDims('gpt-4o-mini', 4_000)
    expect(d.vendor).toBe('openai')
    expect(d.input_chars).toBe(4_000)
    expect(typeof d.est_cost_usd).toBe('number')
    expect(d.est_cost_usd as number).toBeGreaterThan(0)
  })
})
