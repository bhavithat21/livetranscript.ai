import { describe, expect, it } from 'vitest'
import {
  emptyScreenSnapshot, mergeScreenObservation, parseScreenObservation, screenContext,
  screenFileSummary, screenNavigation, type ScreenObservation, type ScreenSnapshot,
} from './screenEvidence'

function observation(overrides: Partial<ScreenObservation> = {}): ScreenObservation {
  return { files: [], visiblePaths: [], terminal: '', requirements: [], ...overrides }
}

function file(lines: string[], startLine: number | null = 1, extra: Partial<ScreenObservation['files'][number]> = {}): ScreenObservation['files'][number] {
  return { path: 'src/order.ts', language: 'typescript', startLine, lines, confidence: 0.97, endOfFile: false, ...extra }
}

function capture(files: ScreenObservation['files'], snapshot = emptyScreenSnapshot()): ScreenSnapshot {
  return mergeScreenObservation(snapshot, observation({ files }))
}

describe('screenshot observation boundary', () => {
  it('validates and copies model output; normalizes workspace separators without guessing missing text', () => {
    const input = observation({ files: [file(['  return "ok";', ''], 12, { path: 'src\\order.ts' })] })
    const parsed = parseScreenObservation(input)
    expect(parsed.files[0]).toMatchObject({ path: 'src/order.ts', startLine: 12, lines: ['  return "ok";', ''] })
    input.files[0].lines[0] = 'changed outside the parser'
    expect(parsed.files[0].lines[0]).toBe('  return "ok";')
  })

  it.each(['../server.ts', '/src/server.ts', 'C:\\src\\server.ts', 'src/../../secret.ts', '__proto__/polluted.ts', 'src/constructor/file.ts', 'src/\nfile.ts'])('rejects unsafe path %s', (path) => {
    expect(() => parseScreenObservation(observation({ files: [file(['code'], 1, { path })] }))).toThrow()
  })

  it('omits credential filenames and source chunks without losing ordinary tree or code evidence', () => {
    const parsed = parseScreenObservation(observation({
      visiblePaths: ['.env.local', 'config/credentials.json', 'certs/private.key', 'src/order.ts', 'src/order.test.ts'],
      files: [
        file(['API_KEY=not-for-the-evidence'], 1, { path: '.env.local', language: 'text' }),
        file(['private certificate text'], 1, { path: 'certs/private.pem', language: 'text' }),
        file(['export function cancelOrder() { return true }'], 1, { endOfFile: true }),
      ],
    }))
    expect(parsed.visiblePaths).toEqual(['src/order.ts', 'src/order.test.ts'])
    expect(parsed.files).toHaveLength(1)
    expect(parsed.files[0].path).toBe('src/order.ts')
    const snapshot = mergeScreenObservation(emptyScreenSnapshot(), parsed)
    expect(screenContext(snapshot, 'cancelOrder')).toContain('export function cancelOrder')
    expect(JSON.stringify(snapshot)).not.toMatch(/API_KEY|private certificate|\.env|private\.pem/)
  })

  it('still rejects malformed secret paths before filtering them from code or the tree', () => {
    for (const path of ['../.env.local', '/config/credentials.json', 'config/../secret.key']) {
      expect(() => parseScreenObservation(observation({ visiblePaths: [path, 'src/order.ts'] }))).toThrow()
      expect(() => parseScreenObservation(observation({ files: [file(['secret'], 1, { path })] }))).toThrow()
    }
  })

  it('rejects prototype keys and inherited schema fields', () => {
    expect(() => parseScreenObservation(JSON.parse('{"files":[],"visiblePaths":[],"terminal":"","requirements":[],"__proto__":{"polluted":true}}'))).toThrow()
    expect(() => parseScreenObservation(Object.create(observation()))).toThrow()
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it.each([0, -1, 1.5, NaN, Infinity, 100_001])('rejects invalid line number %s', (startLine) => {
    expect(() => parseScreenObservation(observation({ files: [file(['code'], startLine)] }))).toThrow()
  })

  it('rejects fabricated shape, overflow, embedded linebreaks, confidence errors, and aggregate oversize', () => {
    expect(() => parseScreenObservation({ files: [] })).toThrow()
    expect(() => parseScreenObservation(observation({ files: [file(['a', 'b'], 100_000)] }))).toThrow()
    expect(() => parseScreenObservation(observation({ files: [file(['a\nb'])] }))).toThrow()
    expect(() => parseScreenObservation(observation({ files: [file(['code'], 1, { confidence: 1.5 })] }))).toThrow()
    expect(() => parseScreenObservation(observation({ files: [file([])] }))).toThrow(/visiblePaths/)
    expect(() => parseScreenObservation(observation({ files: [file(Array(100).fill('x'.repeat(1_200)))] }))).toThrow(/budget/)
  })
})

describe('sparse screenshot reconstruction', () => {
  it('keeps holes and file-name discoveries explicit; never fills missing lines', () => {
    const snapshot = mergeScreenObservation(capture([file(['export function cancel() {'], 8)]), observation({ visiblePaths: ['src/database.ts'] }))
    expect(screenFileSummary(snapshot.files[0])).toEqual({ path: 'src/order.ts', observedLines: 1, uncertainLines: 0, hasConflicts: false, complete: false })
    const context = screenContext(snapshot, 'cancel database')
    expect(context).toContain('[MISSING lines 1-7; do not infer code]')
    expect(context).toContain('[EOF NOT OBSERVED')
    expect(context).toContain('names alone do not establish contents')
    expect(snapshot.files).toHaveLength(1)
    expect(screenNavigation(snapshot, 'database')[0]).toMatchObject({ path: 'src/database.ts', instruction: expect.stringContaining('Only its name') })
  })

  it('merges overlapping matching observations, only becoming complete after every anchored line and EOF are observed', () => {
    let snapshot = capture([file(['b', 'c'], 2, { endOfFile: true })])
    expect(screenFileSummary(snapshot.files[0]).complete).toBe(false)
    expect(screenNavigation(snapshot, 'order')[0].instruction).toContain('line 1')
    snapshot = capture([file(['a', 'b'], 1)], snapshot)
    expect(screenFileSummary(snapshot.files[0])).toMatchObject({ observedLines: 3, complete: true, hasConflicts: false })
    expect(screenContext(snapshot, 'order')).toContain('3 "c"')
  })

  it('keeps unknown line numbers as separate uncertain fragments, even with an apparent EOF', () => {
    const snapshot = capture([file(['function cancel() {'], null), file(['return true;', '}'], null, { endOfFile: true })])
    expect(snapshot.files[0].fragments).toHaveLength(2)
    expect(screenFileSummary(snapshot.files[0])).toMatchObject({ observedLines: 3, uncertainLines: 3, complete: false })
    expect(screenContext(snapshot, 'cancel').match(/\[UNANCHORED capture/g)).toHaveLength(2)
    expect(screenNavigation(snapshot, 'cancel')[0].instruction).toContain('line-number gutter')
  })

  it('does not claim a complete current file when later text has an unknown position', () => {
    const complete = capture([file(['old complete body'], 1, { endOfFile: true })])
    const unknownUpdate = capture([file(['possibly changed body'], null)], complete)
    expect(screenFileSummary(unknownUpdate.files[0]).complete).toBe(false)
  })

  it('retires all previous line anchors after a changed overlap, including distant code with now-stale line numbers', () => {
    const old = capture([file(['old first', 'old second']), file(['old distant'], 30, { endOfFile: true })])
    const updated = capture([file(['inserted line', 'old first'], 1)], old)
    expect(old.files[0].fragments).toHaveLength(2)
    expect(updated.files[0].revision).toBe(2)
    expect(updated.files[0].staleFragments).toHaveLength(2)
    expect(updated.files[0].fragments).toHaveLength(1)
    expect(screenFileSummary(updated.files[0])).toMatchObject({ observedLines: 2, hasConflicts: true, complete: false })
    const context = screenContext(updated, 'order')
    expect(context).toContain('REVISION CONFLICT HISTORY')
    expect(context).not.toContain('30 "old distant"')
    expect(screenNavigation(updated, 'order')[0].instruction).toContain('Conflicting text invalidated earlier line anchors')
  })

  it('treats a changed EOF as a revision change even without overlapping text differences', () => {
    const original = capture([file(['first'], 1), file(['end'], 20, { endOfFile: true })])
    const shortened = capture([file(['first'], 1, { endOfFile: true })], original)
    expect(shortened.files[0].revision).toBe(2)
    expect(shortened.files[0].fragments).toHaveLength(1)
    expect(screenFileSummary(shortened.files[0])).toMatchObject({ observedLines: 1, complete: true })
    expect(shortened.files[0].conflicts[0]).toMatchObject({ resolved: true })
    expect(screenContext(shortened, 'order')).not.toContain('20 "end"')
  })

  it('can resolve a conflict after the current revision is fully observed, while retaining explicit history', () => {
    let snapshot = capture([file(['old start', 'old middle']), file(['old end'], 8, { endOfFile: true })])
    snapshot = capture([file(['new middle'], 2)], snapshot)
    expect(screenFileSummary(snapshot.files[0]).hasConflicts).toBe(true)
    snapshot = capture([file(['new start', 'new middle', 'new end'], 1, { endOfFile: true })], snapshot)
    expect(screenFileSummary(snapshot.files[0])).toMatchObject({ complete: true, hasConflicts: false })
    expect(snapshot.files[0].conflicts.length).toBeGreaterThan(0)
    expect(snapshot.files[0].conflicts.every((conflict) => conflict.resolved)).toBe(true)
  })

  it('never marks low-confidence full coverage complete and asks for targeted recapture', () => {
    const snapshot = capture([file(['const x = ambiguousText;'], 1, { confidence: 0.5, endOfFile: true })])
    expect(screenFileSummary(snapshot.files[0])).toMatchObject({ complete: false, uncertainLines: 1 })
    expect(screenContext(snapshot, 'x')).toContain('[UNCERTAIN]')
    expect(screenNavigation(snapshot, 'x')[0].instruction).toContain('Zoom in')
  })

  it('deduplicates repeated screenshots while preserving capture count and confines terminal output to observed evidence', () => {
    let snapshot = capture([file(['const value = 1;'])])
    snapshot = capture([file(['const value = 1;'])], snapshot)
    snapshot = mergeScreenObservation(snapshot, observation({ terminal: 'Tests: 2 passed', requirements: ['Allow cancellation', 'Allow cancellation'] }))
    expect(snapshot.captures).toBe(3)
    expect(snapshot.files[0].fragments).toHaveLength(1)
    expect(snapshot.requirements).toEqual(['Allow cancellation'])
    expect(screenContext(snapshot, 'tests')).toContain('may be stale; not independently executed')
  })

  it('bounds accumulated snapshot size and never claims evicted files have contents', () => {
    let snapshot = emptyScreenSnapshot()
    for (let i = 0; i < 140; i++) snapshot = capture([file(['content'], 1, { path: `src/file-${i}.ts` })], snapshot)
    expect(snapshot.files).toHaveLength(120)
    expect(snapshot.visiblePaths).toContain('src/file-0.ts')
    expect(screenNavigation(snapshot, 'file-0.ts').find((item) => item.path === 'src/file-0.ts')?.instruction).toContain('Only its name')
    expect(screenContext(snapshot, 'files').length).toBeLessThanOrEqual(28_000)
  })
})

it('preserves relevant source and navigation when requirements, paths, and logs exceed the context budget', () => {
  let snapshot = capture([file(['export function cancelOrder() {', '  return cancelAtomically();', '}'], 1, { endOfFile: true })])
  for (let page = 0; page < 4; page++) {
    snapshot = mergeScreenObservation(snapshot, observation({
      visiblePaths: Array.from({ length: 60 }, (_, index) => `src/long-directory-${page}-${index}-${'x'.repeat(100)}/helper.ts`),
      requirements: Array.from({ length: 25 }, (_, index) => `Requirement ${page}-${index} ${'r'.repeat(900)}`),
      terminal: 'test diagnostic '.repeat(700),
    }))
  }
  const context = screenContext(snapshot, 'Where is cancelOrder?')
  expect(context).toContain('export function cancelOrder()')
  expect(context).toContain('return cancelAtomically()')
  expect(context).toContain('NAVIGATE NEXT:')
  expect(context).toContain('FILE TREE TRUNCATED')
  expect(context).toContain('REQUIREMENTS TRUNCATED')
  expect(context).toContain('TERMINAL TRUNCATED')
  expect(context.length).toBeLessThanOrEqual(28_000)
})
