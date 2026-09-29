import { expect, it } from 'vitest'
import { emptyCoach, resultCurrent } from './state'
import { writingPresentation } from './writingPresentation'
import type { ResultRecord } from './types'
const guidance = { summary: 'Compare inputs', nextAction: 'Implement max', draft: { language: 'Java', code: 'return Math.max(a, b);', explanation: 'Take the larger value' }, look: [], patches: [], findings: [], verify: [], hypotheses: [] }
function fixture() {
  const state = emptyCoach('writing')
  state.question = { id: 'q1', original: 'Max', text: 'Max', at: 0 }
  const result: ResultRecord = { id: 'r1', lane: 'guide', questionId: 'q1', evidenceVersion: 0, codeVersion: 0, taskVersion: 0, contextKey: 'k', status: 'complete', text: '', guidance, model: 'fixture', startedAt: 0, firstUsefulMs: null, totalMs: 1, error: null }
  state.results = [result]
  return { state, result }
}
it('keeps completed code visible across typing and a failed refresh without making it current', () => {
  const { state, result } = fixture()
  state.evidenceVersion++; state.codeVersion++; result.status = 'stale'
  state.results.push({ ...result, id: 'r2', guidance: null, status: 'failed', evidenceVersion: state.evidenceVersion })
  expect(writingPresentation(state)).toBe(result)
  expect(resultCurrent(result, state)).toBe(false)
})
it('keeps code when the latest review has no replacement, then accepts new code', () => {
  const { state, result } = fixture()
  state.evidenceVersion++; result.status = 'stale'
  const review = { ...result, id: 'r2', status: 'complete' as const, evidenceVersion: state.evidenceVersion, guidance: { ...guidance, draft: null } }
  state.results.push(review)
  expect(writingPresentation(state)).toBe(result)
  const replacement = { ...review, id: 'r3', guidance }
  state.results.push(replacement)
  expect(writingPresentation(state)).toBe(replacement)
})
it('does not carry code into a new question or changed task constraints', () => {
  const { state } = fixture()
  state.task.version++
  expect(writingPresentation(state)).toBeUndefined()
  state.task.version--; state.question!.id = 'q2'
  expect(writingPresentation(state)).toBeUndefined()
})
it('never retains incomplete or rejected output', () => {
  const { state, result } = fixture()
  result.status = 'running'; result.guidance = null
  expect(writingPresentation(state)).toBeUndefined()
})
