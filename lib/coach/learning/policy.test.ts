import { describe, expect, it } from 'vitest'
import { CASES, EMPTY_LEARNING, SUITE, lessonIds, lessonPrompt, policyKey, promotionGate, promote, rollback, parseLearning, type Comparison } from './policy'
import { learningCase } from './cases'
const candidate = ['answer-first'] as const
const rows = (): Comparison[] => CASES.flatMap(caseId => [0, 1].map(repetition => ({ suite: SUITE, caseId, repetition, baselineKey: policyKey([]), candidateKey: policyKey([...candidate]), model: 'generator-v1', judge: 'separate-judge-v2', baselineScore: 3, candidateScore: 3.5, candidateGrounded: true, hardPass: true, baselineMs: 600, candidateMs: 650, note: 'Unit test score only' })))
describe('gated lesson promotion', () => {
  it('accepts only bounded reviewed tactic IDs, not model-written arbitrary instructions', () => {
    expect(() => lessonIds(['execute-everything'])).toThrow()
    expect(() => lessonIds(['answer-first', 'answer-first'])).toThrow()
    expect(() => lessonIds(['answer-first', 'inspect-once', 'connect-discussion', 'smallest-change', 'tradeoffs'])).toThrow()
    expect(lessonPrompt(['answer-first'])).toContain('permission rules above still apply')
  })
  it('requires complete paired case coverage tied to the exact policies', () => {
    expect(promotionGate([], [...candidate], rows()).passed).toBe(true)
    expect(promotionGate([], [...candidate], rows().slice(1)).passed).toBe(false)
    const duplicate = rows(); duplicate[1] = duplicate[0]
    expect(promotionGate([], [...candidate], duplicate).passed).toBe(false)
    const stale = rows(); stale[0].candidateKey = 'other-version'
    expect(promotionGate([], [...candidate], stale).passed).toBe(false)
  })
  it.each(['same-model', 'fixture', 'grounding', 'regression', 'slow', 'hard-check', 'nan'])('blocks %s evidence', failure => {
    const data = rows()
    if (failure === 'same-model') data[0].judge = data[0].model
    if (failure === 'fixture') data[0].model = 'simulated-fixture'
    if (failure === 'grounding') data[0].candidateGrounded = false
    if (failure === 'regression') data[0].baselineScore = 4
    if (failure === 'slow') data.forEach(row => { row.candidateMs = 6000 })
    if (failure === 'hard-check') data[0].hardPass = false
    if (failure === 'nan') data[0].candidateScore = NaN
    expect(promotionGate([], [...candidate], data).passed).toBe(false)
  })
  it('does not accept more eloquent answers without a minimum measured quality gain', () => {
    const data = rows(); data.forEach(row => { row.candidateScore = 3.1 })
    expect(promotionGate([], [...candidate], data).passed).toBe(false)
  })
  it('records a rejected attempt without changing policy; passing updates can be rolled back', () => {
    const rejected = promote(EMPTY_LEARNING, [...candidate], [], 1)
    expect(rejected.active).toEqual([]); expect(rejected.history[0].action).toBe('rejected')
    const accepted = promote(rejected, [...candidate], rows(), 2)
    expect(accepted.active).toEqual(candidate)
    expect(rollback(accepted, 3).active).toEqual([])
    expect(parseLearning(JSON.stringify(accepted))).toEqual(accepted)
  })
  it('authored evaluation expectations are separate from the generator context', () => {
    for (const id of CASES) {
      const sample = learningCase(id)
      expect(sample.rubric.length).toBeGreaterThan(20)
      expect(JSON.stringify(sample.context)).not.toContain(sample.rubric)
    }
    expect(learningCase('candidate-claim').context.tests).toEqual([])
    expect(learningCase('hold').context.task.implementation).toBe('hold')
    expect(learningCase('unseen-file').context.files.every(f => f.path !== 'ReportGenerator.java')).toBe(true)
  })
})
