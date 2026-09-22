import { describe, expect, it } from 'vitest'
import { buildRepoIndex, createRepoFile, extractQuestions, isIndexablePath, rankRepoFiles, repoContext } from './index'

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

  it('keeps distant relevant locations with exact source line numbers and explicit gaps', () => {
    const lines = Array.from({ length: 650 }, (_, row) => `// unrelated source ${row + 1}`)
    lines[149] = 'export function cancelOrder(id: string) {'
    lines[150] = '  return store.cancel(id)'
    lines[151] = '}'
    lines[499] = 'export function publishCancellation(id: string) {'
    lines[500] = '  events.publish({ type: "cancelled", id })'
    lines[501] = '}'
    const index = buildRepoIndex('orders', [createRepoFile('src/orders.ts', lines.join('\r\n'))])
    const [match] = rankRepoFiles(index, 'Trace cancelOrder and publishCancellation')
    expect(match.excerpt).toContain('150 export function cancelOrder(id: string) {')
    expect(match.excerpt).toContain('500 export function publishCancellation(id: string) {')
    expect(match.excerpt).toMatch(/\[OMITTED lines \d+-\d+; source not included\]/)
    expect(match.excerpt.length).toBeLessThanOrEqual(3_600)
    for (const line of match.excerpt.split('\n')) {
      const source = line.match(/^(\d+) (.*)$/)
      if (source) expect(source[2]).toBe(lines[Number(source[1]) - 1])
    }
    const context = repoContext(index, 'Trace cancelOrder and publishCancellation')!
    expect(context).toContain('EVIDENCE 1: "src/orders.ts"')
    expect(context).toContain('150 export function cancelOrder')
    expect(context).toContain('OMITTED ranges are gaps, never consecutive code')
  })

  it('omits oversized source lines without clipping them or hiding nearby evidence', () => {
    const oversized = `const cancellationData = "${'x'.repeat(8_000)}"`
    const index = buildRepoIndex('orders', [createRepoFile('src/orders.ts', [
      'export function cancelOrder() {',
      '  const changed = store.cancel()',
      oversized,
      '  if (changed) publishCancellation()',
      '}',
    ].join('\n'))])
    const [match] = rankRepoFiles(index, 'cancelOrder cancellationData publishCancellation')
    expect(match.excerpt).toContain('1 export function cancelOrder() {')
    expect(match.excerpt).toContain('4   if (changed) publishCancellation()')
    expect(match.excerpt).toContain('[OMITTED lines 3-3; source not included]')
    expect(match.excerpt).not.toContain('const cancellationData')
    expect(match.excerpt.length).toBeLessThanOrEqual(3_600)
  })

  it('bounds the complete context even when filenames and symbol metadata are large', () => {
    const longName = 'name'.repeat(200)
    const files = Array.from({ length: 15 }, (_, row) => createRepoFile(
      `src/${'nested/'.repeat(900)}orders-${row}.ts`,
      `export function cancelOrder() {}\nexport function ${longName}() {}`,
    ))
    const index = buildRepoIndex('project'.repeat(1_000), files)
    const context = repoContext(index, 'cancelOrder')!
    expect(context.length).toBeLessThanOrEqual(32_000)
    expect(context).toContain('paths OMITTED from tree')
    expect(context).toContain('relevant files OMITTED by context budget')
    expect(context).toContain('1 export function cancelOrder() {}')
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
