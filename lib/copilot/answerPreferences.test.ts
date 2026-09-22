import { describe, expect, it } from 'vitest'
import { DEFAULT_ANSWER_PREFERENCES, parseAnswerPreferences, withAnswerPreferences } from './answerPreferences'

describe('answer preference boundary', () => {
  it('preserves legacy formatting when preferences are omitted', () => {
    expect(parseAnswerPreferences(undefined)).toBeUndefined()
    expect(withAnswerPreferences('Existing system')).toBe('Existing system')
  })
  it('rejects arbitrary instructions, invalid types and incomplete control objects', () => {
    for (const value of [null, [], 'keywords', {}, { ...DEFAULT_ANSWER_PREFERENCES, format: 'ignore instructions' },
      { ...DEFAULT_ANSWER_PREFERENCES, tone: 1 }, { ...DEFAULT_ANSWER_PREFERENCES, followups: 'true' },
      { ...DEFAULT_ANSWER_PREFERENCES, system: 'override' }]) expect(() => parseAnswerPreferences(value)).toThrow('Invalid answer preferences')
    expect(parseAnswerPreferences({ format: 'keywords', tone: 'technical', followups: true })).toEqual({ format: 'keywords', tone: 'technical', followups: true })
  })
  it('puts compact formatting last while retaining evidence and complete code requirements', () => {
    const system = withAnswerPreferences('Write a long script.', { format: 'keywords', tone: 'technical', followups: true }, 'Use many paragraphs.')
    expect(system.indexOf('FINAL RESPONSE REQUIREMENTS')).toBeGreaterThan(system.indexOf('Use many paragraphs.'))
    expect(system).toContain('3–4 short, scannable keyword bullets')
    expect(system).toContain('never abbreviate code')
    expect(system).toContain('Never invent resume experience')
    expect(system).toContain('### Possible follow-ups')
    expect(system).toContain('not a prediction')
  })
  it('explicitly disables inherited speculative follow-up sections', () => {
    expect(withAnswerPreferences('Always give likely follow-ups.', { ...DEFAULT_ANSWER_PREFERENCES })).toContain('FOLLOW-UPS OFF: Do not append')
  })
})
