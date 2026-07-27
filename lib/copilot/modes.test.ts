import { describe, it, expect } from 'vitest'
import { modeProfile, modelForTier, vendorForModel, thinkingConfigFor, fastFallbackModel, fallbackChain, MODE_PROFILES, MODE_ORDER } from './modes'

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
  it('every ordered mode has a profile with a system prompt + sane temperature + tier + token budget', () => {
    for (const m of MODE_ORDER) {
      const p = MODE_PROFILES[m]
      expect(p.system.length).toBeGreaterThan(50)
      expect(p.temperature).toBeGreaterThanOrEqual(0)
      expect(p.temperature).toBeLessThanOrEqual(1)
      expect(['fast', 'smart']).toContain(p.tier)
      expect(p.maxTokens).toBeGreaterThanOrEqual(1000)
    }
  })
  it('behavioral has the largest token budget (two full STAR stories must fit uncut)', () => {
    expect(MODE_PROFILES.behavioral.maxTokens).toBeGreaterThan(MODE_PROFILES.general.maxTokens)
    expect(MODE_PROFILES.behavioral.maxTokens).toBeGreaterThanOrEqual(MODE_PROFILES.coding.maxTokens)
  })
})

describe('purpose-specific model tiers', () => {
  it('coding/systemDesign/behavioral use the smart tier (accuracy-first); general uses fast', () => {
    expect(MODE_PROFILES.coding.tier).toBe('smart')
    expect(MODE_PROFILES.systemDesign.tier).toBe('smart')
    // Behavioral moved to smart: most hallucination/voice-sensitive + must stay
    // undetectable; long-form so thinking-off streams instantly anyway.
    expect(MODE_PROFILES.behavioral.tier).toBe('smart')
    expect(MODE_PROFILES.general.tier).toBe('fast')
  })
  it('modelForTier resolves to concrete models (env-overridable)', () => {
    expect(modelForTier('fast')).toBeTruthy()
    expect(modelForTier('smart')).toBeTruthy()
    // smart != fast by default (stronger model for correctness-first modes)
    expect(modelForTier('smart')).not.toBe(modelForTier('fast'))
  })
  it('routes the fast tier to Groq (throughput) and smart to Anthropic (cached coding)', () => {
    expect(vendorForModel(modelForTier('smart'))).toBe('anthropic')
    expect(vendorForModel(modelForTier('fast'))).toBe('groq')
  })
  it('vendorForModel infers vendor from the model id', () => {
    expect(vendorForModel('claude-sonnet-5')).toBe('anthropic')
    expect(vendorForModel('gpt-4o-mini')).toBe('openai')
    expect(vendorForModel('llama-3.3-70b-versatile')).toBe('groq')
    expect(vendorForModel('openai/gpt-oss-120b')).toBe('groq')
    expect(vendorForModel('qwen/qwen3.6-27b')).toBe('groq')
    expect(vendorForModel('gemini-flash-latest')).toBe('google')
  })
  it('fastFallbackModel picks a reachable fast model (Haiku if Anthropic key set, else OpenAI)', () => {
    const prev = process.env.ANTHROPIC_API_KEY
    const prevG = process.env.GROQ_API_KEY
    const prevO = process.env.OPENAI_API_KEY
    delete process.env.GROQ_API_KEY
    delete process.env.OPENAI_API_KEY
    process.env.ANTHROPIC_API_KEY = 'x'
    expect(vendorForModel(fastFallbackModel())).toBe('anthropic')
    delete process.env.ANTHROPIC_API_KEY
    process.env.OPENAI_API_KEY = 'x'
    expect(vendorForModel(fastFallbackModel())).toBe('openai')
    if (prev !== undefined) process.env.ANTHROPIC_API_KEY = prev; else delete process.env.ANTHROPIC_API_KEY
    if (prevG !== undefined) process.env.GROQ_API_KEY = prevG
    if (prevO !== undefined) process.env.OPENAI_API_KEY = prevO
  })
})

describe('fallbackChain (cross-vendor resilience)', () => {
  const save = () => ({ a: process.env.ANTHROPIC_API_KEY, g: process.env.GROQ_API_KEY, o: process.env.OPENAI_API_KEY })
  const restore = (s: { a?: string; g?: string; o?: string }) => {
    for (const [k, v] of [['ANTHROPIC_API_KEY', s.a], ['GROQ_API_KEY', s.g], ['OPENAI_API_KEY', s.o]] as const) {
      if (v !== undefined) process.env[k] = v; else delete process.env[k]
    }
  }

  it('builds a cross-vendor chain for the smart tier when all keys are set', () => {
    const s = save()
    process.env.ANTHROPIC_API_KEY = 'x'; process.env.GROQ_API_KEY = 'x'; process.env.OPENAI_API_KEY = 'x'
    const chain = fallbackChain('claude-sonnet-5')
    // Never includes the primary; every entry reachable; spans other vendors.
    expect(chain).not.toContain('claude-sonnet-5')
    const vendors = new Set(chain.map(vendorForModel))
    expect(vendors.has('openai')).toBe(true) // peer
    expect(vendors.has('groq')).toBe(true) // backstop
    expect(chain.length).toBeGreaterThanOrEqual(2)
    restore(s)
  })

  it('drops candidates whose vendor has no key (never points at an unconfigured provider)', () => {
    const s = save()
    process.env.ANTHROPIC_API_KEY = 'x'; delete process.env.OPENAI_API_KEY; delete process.env.GROQ_API_KEY
    // Only Anthropic reachable → the fast primary's chain must be Anthropic-only (Haiku).
    const chain = fallbackChain('llama-3.3-70b-versatile')
    expect(chain.every((m) => vendorForModel(m) === 'anthropic')).toBe(true)
    expect(chain).toContain('claude-haiku-4-5')
    restore(s)
  })

  it('is empty only when NO vendor key is set', () => {
    const s = save()
    delete process.env.ANTHROPIC_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.OPENAI_API_KEY
    expect(fallbackChain('claude-sonnet-5')).toEqual([])
    restore(s)
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
