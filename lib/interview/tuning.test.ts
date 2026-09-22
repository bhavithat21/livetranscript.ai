import { describe, expect, it } from 'vitest'
import { EMPTY_TUNING, MAX_CALIBRATION, hasAcceptedRun, parseTuning, publishTuning, rollbackTuning, tuningKey, tuningSession, type TuningRun } from './tuning'
import { interviewPrompt, isSession, parseInterviewRequest } from './session'
const run: TuningRun = { id: 'run', question: 'Test?', mode: 'general', answer: 'Observed output', transcript: 'Interviewer: Test?', instructions: '', calibration: 'Be concise', revision: 0, firstTokenMs: 20, totalMs: 50, status: 'complete', hasImage: false, expected: 'Correct facts', verdict: 'pass', notes: '' }
describe('versioned calibration', () => {
  it('publishes and rolls back without losing the preceding snapshot', () => {
    const a = publishTuning(EMPTY_TUNING, 'First', 1)
    const b = publishTuning(a, 'Second', 2)
    const c = rollbackTuning(b, 3)
    expect(c.active).toEqual({ revision: 3, instructions: 'First', updatedAt: 3 })
    expect(c.previous?.instructions).toBe('Second')
    expect(EMPTY_TUNING.active.revision).toBe(0)
    expect(parseTuning(JSON.stringify(c))).toEqual(c)
  })
  it('rejects invalid and oversized profiles', () => {
    expect(() => publishTuning(EMPTY_TUNING, 'x'.repeat(MAX_CALIBRATION + 1), 1)).toThrow()
    for (const value of [null, {}, { version: 1, active: { revision: -1 }, previous: null }]) expect(() => parseTuning(JSON.stringify(value))).toThrow()
  })
  it('scopes keys to the exact account', () => { expect(tuningKey('a/b')).not.toBe(tuningKey('a%2Fb')); expect(tuningKey('alice')).not.toBe(tuningKey('bob')) })
  it('accepts only successful, reviewed outputs for the exact instructions', () => {
    expect(hasAcceptedRun([run], 'Be concise')).toBe(true)
    expect(hasAcceptedRun([run], 'Changed')).toBe(false)
    expect(hasAcceptedRun([{ ...run, status: 'error' }], 'Be concise')).toBe(false)
    expect(hasAcceptedRun([{ ...run, answer: '' }], 'Be concise')).toBe(false)
    expect(hasAcceptedRun([{ ...run, verdict: 'unreviewed' }], 'Be concise')).toBe(false)
  })
  it('creates bounded system reports that preserve attribution and missing timing', () => {
    const session = tuningSession([{ ...run, firstTokenMs: null, transcript: 'x'.repeat(6000), answer: 'a'.repeat(13000) }], 1)
    expect(isSession(session)).toBe(true)
    expect(session.kind).toBe('tuning')
    expect(session.transcript).toContain('not a candidate answer')
    expect(session.transcript).toContain('last 5000 characters only')
    expect(session.transcript).toContain('[Output truncated in report.]')
    expect(session.transcript).toContain('first token: not observed')
  })
  it('separates system evaluation from candidate coaching and validates subject', () => {
    const body = { action: 'feedback', transcript: 'AI COPILOT OUTPUT', captureNote: 'System test', coverage: 'Full', subject: 'copilot' }
    const prompt = interviewPrompt(parseInterviewRequest(body))
    expect(prompt.system).toContain('COPILOT SYSTEM')
    expect(prompt.system).toContain('not a coach grading the candidate')
    expect(prompt.system).toContain('Suggestions do NOT apply automatically')
    expect(interviewPrompt(parseInterviewRequest({ ...body, subject: 'candidate' })).system).toContain('Answer-by-answer feedback')
    expect(() => parseInterviewRequest({ ...body, subject: 'other' })).toThrow()
  })
})
