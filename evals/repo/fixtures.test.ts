import { describe, expect, it } from 'vitest'
import { repoBenchmarkFixtures, scoreRepoBenchmark } from './fixtures'

describe('repository benchmark diagnostics', () => {
  it('penalizes generic answers, invented execution and failure to acknowledge gaps', () => {
    const fixture = repoBenchmarkFixtures[0]
    const generic = scoreRepoBenchmark(fixture, 'We ran the tests. All tests passed. Improve your architecture.')
    expect(generic).toMatchObject({ pathCoverage: 0, conceptCoverage: 0, preservesUnknowns: false, noExecutionClaim: false, proxyScore: 0 })
  })
  it('recognizes grounded discussion but labels its score as a proxy', () => {
    const score = scoreRepoBenchmark(repoBenchmarkFixtures[0], 'src/service/orders.ts emits duplicate events on retry; tests/orders.test.ts observes two. A conditional atomic transition is needed for concurrency. The implementation is not captured; inspect before patching.')
    expect(score.proxyScore).toBe(1)
    expect(score.noExecutionClaim).toBe(true)
  })
})
