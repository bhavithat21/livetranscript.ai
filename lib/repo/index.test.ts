import { describe, expect, it } from 'vitest'
import { buildRepoIndex, createRepoFile, extractQuestions, isIndexablePath, rankRepoFiles } from './index'

describe('repository interview index', () => {
  it('skips dependencies, generated output, and likely secrets', () => {
    expect(isIndexablePath('src/orders/service.ts')).toBe(true)
    expect(isIndexablePath('node_modules/pkg/index.js')).toBe(false)
    expect(isIndexablePath('dist/bundle.js')).toBe(false)
    expect(isIndexablePath('.env.local')).toBe(false)
    expect(isIndexablePath('certs/private.pem')).toBe(false)
  })

  it('extracts symbols and ranks the matching implementation above unrelated files', () => {
    const index = buildRepoIndex('orders', [
      createRepoFile('src/orders/service.ts', 'export class OrderService {\n  async cancelOrder(id: string) { return id }\n}'),
      createRepoFile('src/users/service.ts', 'export class UserService {\n  async findUser(id: string) { return id }\n}'),
      createRepoFile('src/orders/service.test.ts', 'describe("cancelOrder", () => { it("is idempotent", () => {}) })'),
    ])
    const matches = rankRepoFiles(index, 'Where is cancelOrder implemented?', 3)
    expect(matches[0].path).toBe('src/orders/service.ts')
    expect(matches[0].symbols).toContain('OrderService')
    const testMatches = rankRepoFiles(index, 'What tests verify cancelOrder?', 3)
    expect(testMatches.some((match) => match.path.endsWith('service.test.ts'))).toBe(true)
  })

  it('captures every completed question in a compound transcript', () => {
    expect(extractQuestions('Where is auth handled? How is the token verified? Tell me what you would change.')).toEqual([
      'Where is auth handled?',
      'How is the token verified?',
      'Tell me what you would change.',
    ])
  })
})

describe('live question ledger', () => {
  it('captures diarized questions, file paths, and an unfinished final question', () => {
    expect(extractQuestions('Speaker 1: Where is auth handled?\nSpeaker 2: Okay, explain orders.service.ts.\nInterviewer: How should cancellation')).toEqual([
      'Where is auth handled?', 'explain orders.service.ts.', 'How should cancellation',
    ])
  })

  it('retains distinct completed questions that share a prefix', async () => {
    const { mergeQuestionLedger } = await import('./index')
    const questions = mergeQuestionLedger([], 'How does cancellation work? How does cancellation work under concurrency?')
    expect(questions).toHaveLength(2)
    expect(new Set(questions.map((q) => q.id)).size).toBe(2)
  })

  it('reconciles growing ASR tails without losing the row identity', async () => {
    const { mergeQuestionLedger } = await import('./index')
    const start = mergeQuestionLedger([], 'Speaker 1: How should we cancel')
    const next = mergeQuestionLedger(start, 'Speaker 1: How should we cancel an order?')
    expect(next).toHaveLength(1)
    expect(next[0].id).toBe(start[0].id)
    expect(next[0].text).toBe('How should we cancel an order?')
  })

  it('does not duplicate later questions when ASR changes an earlier question length', async () => {
    const { mergeQuestionLedger } = await import('./index')
    const start = mergeQuestionLedger([], 'How do we cancell orders? What tests apply?')
    const next = mergeQuestionLedger(start, 'How do we cancel orders? What tests apply?')
    expect(next).toHaveLength(2)
    expect(next.map((q) => q.id)).toEqual(start.map((q) => q.id))
    expect(next[0].text).toBe('How do we cancel orders?')
  })

  it('keeps repeated questions at different transcript positions', async () => {
    const { mergeQuestionLedger } = await import('./index')
    const start = mergeQuestionLedger([], 'What tests apply?')
    const transcript = 'What tests apply? I would test cancellation. What tests apply?'
    const next = mergeQuestionLedger(start, transcript)
    expect(next).toHaveLength(2)
    expect(mergeQuestionLedger(next, transcript)).toBe(next)
  })

  it('bounds the ledger to the most recent questions', async () => {
    const { MAX_QUESTIONS, mergeQuestionLedger } = await import('./index')
    const transcript = Array.from({ length: MAX_QUESTIONS + 4 }, (_, n) => `What about case ${n}?`).join(' ')
    const ledger = mergeQuestionLedger([], transcript)
    expect(ledger).toHaveLength(MAX_QUESTIONS)
    expect(ledger[0].text).toBe('What about case 4?')
    expect(ledger.at(-1)?.text).toBe(`What about case ${MAX_QUESTIONS + 3}?`)
  })
})
