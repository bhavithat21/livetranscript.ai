import { describe, expect, it } from 'vitest'
import { parseGuidance } from './validation'
import { buildContext } from './context'
import { emptyCoach, reduceCoach } from './state'

function context() {
  let state = emptyCoach('draft-test')
  state = reduceCoach(state, { type: 'session.start', permission: 'practice', objective: 'Write a max function', sessionId: state.sessionId, id: '1', at: 1 })
  state = reduceCoach(state, { type: 'question.new', original: 'Write max in Java', text: 'Write max in Java', sessionId: state.sessionId, id: '2', at: 2 })
  return buildContext(state)
}
const output = { summary: 'Compare the two values.', nextAction: 'Write a function taking two integers.', draft: { language: 'Java', code: 'int max(int a, int b) { return a > b ? a : b; }', explanation: 'Proposed implementation; not executed.' }, look: [], patches: [], findings: [], verify: [], hypotheses: [] }
describe('standalone writing guidance', () => {
  it('accepts a proposed solution without inventing observed files', () => {
    const packet = context()
    expect(packet.knownPaths).toEqual([])
    const result = parseGuidance(output, packet)
    expect(result.draft?.code).toBe(output.draft.code)
    expect(result.nextAction).toBe(output.nextAction)
    expect(result.patches).toEqual([])
  })
  it('still enforces the interviewer implementation hold', () => {
    const packet = context(); packet.task.implementation = 'hold'
    expect(() => parseGuidance(output, packet)).toThrow('Implementation is on hold')
  })
  it('rejects invented source references even alongside a draft', () => {
    expect(() => parseGuidance({ ...output, look: [{ path: 'Invented.java', startLine: null, endLine: null, symbol: '', reason: 'Read it' }] }, context())).toThrow('has not been observed')
  })
})
