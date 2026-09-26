// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SCENARIOS } from './scenarios'
import { RealtimeSimulator } from './runner'

describe('shared production controller + detector real-time simulation', () => {
  for (const scenario of SCENARIOS) it(scenario.name, async () => {
    const simulator = new RealtimeSimulator(scenario, 1)
    try { const report = await simulator.finish(); expect(report.failures, JSON.stringify(report, null, 2)).toEqual([]) }
    finally { simulator.dispose() }
  })
})

it('runs every scenario with 25 reproducible response-timing seeds', async () => {
  const results = []
  for (let seed = 1; seed <= 25; seed++) for (const scenario of SCENARIOS) {
    const simulator = new RealtimeSimulator(scenario, seed)
    try { results.push(await simulator.finish()) } finally { simulator.dispose() }
  }
  expect(results.flatMap(r => r.failures.map(f => `${r.scenarioId} seed ${r.seed}: ${f}`))).toEqual([])
  // Optional CI artifact; this contains synthetic report data only.
  if (process.env.SIMULATOR_REPORT) {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { dirname } = await import('node:path')
    mkdirSync(dirname(process.env.SIMULATOR_REPORT), { recursive: true })
    writeFileSync(process.env.SIMULATOR_REPORT, JSON.stringify({ format: 'livetranscript-simulator-suite-v1', providerInference: false, runs: results.length, failures: results.filter(r => !r.passed).length, results }, null, 2))
  }
}, 20_000)

it('reproduces identical reports for the same seed and protects against future evidence', async () => {
  const scenario = SCENARIOS.find(s => s.id === 'late-frame')!
  const a = new RealtimeSimulator(scenario, 18), b = new RealtimeSimulator(scenario, 18)
  try {
    await a.advance(50)
    expect(a.getSnapshot().state.files).toEqual([])
    expect(a.getSnapshot().requests).toEqual([])
    expect(await a.finish()).toEqual(await b.finish())
  } finally { a.dispose(); b.dispose() }
})
it('dispose/reset prevents stale callbacks mutating a later session', async () => {
  const scenario = SCENARIOS.find(s => s.id === 'latest-wins')!
  const old = new RealtimeSimulator(scenario, 77)
  await old.advance(1000)
  old.dispose()
  const frozen = old.getSnapshot()
  await old.advance(12000)
  expect(old.getSnapshot()).toBe(frozen)
  expect(old.clock.pending()).toBe(0)
  const next = new RealtimeSimulator(scenario, 78)
  try { expect(next.getSnapshot().state.files).toEqual([]); expect((await next.finish()).passed).toBe(true) } finally { next.dispose() }
})
it('rejects invalid clock/seed inputs and unfinished reports cannot pass', async () => {
  expect(() => new RealtimeSimulator(SCENARIOS[0], NaN)).toThrow()
  const simulator = new RealtimeSimulator(SCENARIOS[0])
  try { expect(simulator.report().passed).toBe(false); await expect(simulator.advance(Infinity)).rejects.toThrow() } finally { simulator.dispose() }
})
