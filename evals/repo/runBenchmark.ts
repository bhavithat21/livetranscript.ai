import { execFileSync } from 'node:child_process'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertRepoModelConfigured } from '../../lib/repo/modelPolicy'
import { collectBenchmark, configFromEnv, type BenchmarkReport } from './benchmark'

// Never spend model credits in the normal unit suite or offline review commands.
describe.skipIf(process.env.REPO_BENCHMARK_LIVE !== '1' || !!process.env.REPO_BENCHMARK_ACTION)('live repository purpose benchmark', () => {
  it('measures explicit candidates using production prompts and provider settings', async () => {
    const config = configFromEnv(process.env)
    config.models.forEach(assertRepoModelConfigured)
    let gitCommit: string | null = null
    try { gitCommit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { /* archive checkout */ }
    const output = process.env.REPO_BENCHMARK_REPORT ?? 'benchmark-results/repo-report.json'
    await mkdir(dirname(output), { recursive: true })
    const checkpoint = async (report: BenchmarkReport) => {
      await writeFile(`${output}.partial`, `${JSON.stringify(report, null, 2)}\n`)
      await rename(`${output}.partial`, output)
    }
    const report = await collectBenchmark({ config, mode: 'live', gitCommit, checkpoint })
    expect(report.rows.length).toBe(report.expectedCalls)
    expect(report.rows.some((row) => row.status === 'completed'), `No provider completed; inspect ${output}`).toBe(true)
  })
})
