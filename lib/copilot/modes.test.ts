import { describe, it, expect } from 'vitest'
import { modeProfile, modelForTier, vendorForModel, thinkingConfigFor, MODE_PROFILES, MODE_ORDER } from './modes'

describe('modeProfile', () => {
  it('returns the requested mode', () => {
    expect(modeProfile('coding').id).toBe('coding')
    expect(modeProfile('systemDesign').id).toBe('systemDesign')
    expect(modeProfile('behavioral').id).toBe('behavioral')
  })
  it('falls back to general for unknown/undefined', () => {
    expect(modeProfile(undefined).id).toBe('general')
    expect(modeProfile('nonsense').id).toBe('general')
  })
  it('every ordered mode has a profile with a system prompt + sane temperature + tier', () => {
    for (const m of MODE_ORDER) {
      const p = MODE_PROFILES[m]
      expect(p.system.length).toBeGreaterThan(50)
      expect(p.temperature).toBeGreaterThanOrEqual(0)
      expect(p.temperature).toBeLessThanOrEqual(1)
      expect(['fast', 'smart']).toContain(p.tier)
    }
  })
})

describe('purpose-specific model tiers', () => {
  it('coding + system design use the smart tier; behavioral + general use fast', () => {
    expect(MODE_PROFILES.coding.tier).toBe('smart')
    expect(MODE_PROFILES.systemDesign.tier).toBe('smart')
    expect(MODE_PROFILES.behavioral.tier).toBe('fast')
    expect(MODE_PROFILES.general.tier).toBe('fast')
  })
  it('modelForTier resolves to concrete models (env-overridable)', () => {
    expect(modelForTier('fast')).toBeTruthy()
    expect(modelForTier('smart')).toBeTruthy()
    // smart != fast by default (stronger model for correctness-first modes)
    expect(modelForTier('smart')).not.toBe(modelForTier('fast'))
  })
  it('routes BOTH tiers to Anthropic by default (one vendor → shared prompt cache)', () => {
    expect(vendorForModel(modelForTier('smart'))).toBe('anthropic')
    expect(vendorForModel(modelForTier('fast'))).toBe('anthropic')
  })
  it('vendorForModel infers vendor from the model id prefix', () => {
    expect(vendorForModel('claude-sonnet-5')).toBe('anthropic')
    expect(vendorForModel('gpt-4o-mini')).toBe('openai')
  })
  it('thinkingConfigFor: disables thinking for coding, adaptive+summarized for system design', () => {
    // Sonnet 5 is thinking-capable: coding streams immediately (thinking off),
    // system design shows visible progress (adaptive + summarized).
    expect(thinkingConfigFor('coding', 'claude-sonnet-5')).toEqual({ thinking: { type: 'disabled' } })
    expect(thinkingConfigFor('systemDesign', 'claude-sonnet-5')).toEqual({
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: 'medium',
    })
  })
  it('thinkingConfigFor: omits thinking/effort on models that reject them (Haiku, OpenAI)', () => {
    // These params 400 on Haiku 4.5 and OpenAI — must send nothing.
    expect(thinkingConfigFor('systemDesign', 'claude-haiku-4-5')).toEqual({})
    expect(thinkingConfigFor('coding', 'gpt-4o-mini')).toEqual({})
  })
})
