// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { expect, it } from 'vitest'
import { emptyCoach } from './state'
import type { ResultRecord } from './types'
import { usePinnedWriting } from './usePinnedWriting'
it('keeps code unchanged across replacements and pruning until Update code is chosen', () => {
  const state = emptyCoach('pin'); state.question = { id: 'q', text: 'Max', original: 'Max', at: 0 }
  const first: ResultRecord = { id: 'first', lane: 'guide', status: 'complete', questionId: 'q', evidenceVersion: 0, codeVersion: 0, taskVersion: 0, contextKey: '', text: '', model: 'fixture', startedAt: 0, firstUsefulMs: 0, totalMs: 1, error: null, guidance: { summary: 'Max', draft: { language: 'Java', code: 'return a;', explanation: 'First proposal' }, look: [], patches: [], findings: [], verify: [], hypotheses: [] } }
  state.results = [first]
  const hook = renderHook(({ value }) => usePinnedWriting(value), { initialProps: { value: state } })
  const newer = { ...first, id: 'newer', evidenceVersion: 1, guidance: { ...first.guidance!, draft: { language: 'Java', code: 'return Math.max(a,b);', explanation: 'New proposal' } } }
  hook.rerender({ value: { ...state, evidenceVersion: 1, results: [newer] } })
  expect(hook.result.current.result).toBe(first)
  expect(hook.result.current.updateAvailable).toBe(true)
  act(() => hook.result.current.acceptUpdate())
  expect(hook.result.current.result).toBe(newer)
  hook.rerender({ value: { ...state, question: { ...state.question!, id: 'next-question' }, results: [] } })
  expect(hook.result.current.result).toBeUndefined()
})
