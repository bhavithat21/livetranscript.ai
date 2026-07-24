import { describe, it, expect } from 'vitest'
import { modeProfile, modelForTier, vendorForModel, MODE_PROFILES, MODE_ORDER } from './modes'

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
  it('routes smart tier to Anthropic (Claude) and fast to OpenAI by default', () => {
    expect(vendorForModel(modelForTier('smart'))).toBe('anthropic')
    expect(vendorForModel(modelForTier('fast'))).toBe('openai')
  })
  it('vendorForModel infers vendor from the model id prefix', () => {
    expect(vendorForModel('claude-sonnet-5')).toBe('anthropic')
    expect(vendorForModel('gpt-4o-mini')).toBe('openai')
  })
})
