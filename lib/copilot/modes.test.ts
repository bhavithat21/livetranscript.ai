import { describe, it, expect } from 'vitest'
import { modeProfile, MODE_PROFILES, MODE_ORDER } from './modes'

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
  it('every ordered mode has a profile with a system prompt + sane temperature', () => {
    for (const m of MODE_ORDER) {
      const p = MODE_PROFILES[m]
      expect(p.system.length).toBeGreaterThan(50)
      expect(p.temperature).toBeGreaterThanOrEqual(0)
      expect(p.temperature).toBeLessThanOrEqual(1)
    }
  })
})
