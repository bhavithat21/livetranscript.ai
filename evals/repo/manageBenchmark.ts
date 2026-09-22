import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoProvider, type RepoQualityGates } from '../../lib/repo/modelPolicy'
import { configFromEnv, trialSchedule, type BenchmarkReport } from './benchmark'
import { DEFAULT_GATES, reviewMarkdown, reviewTemplate, selectModels, selectionMarkdown, type BenchmarkReviews } from './select'
import { suiteManifest } from './suite'

const action = process.env.REPO_BENCHMARK_ACTION
async function save(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
}

describe.skipIf(!['plan', 'review-template', 'select'].includes(action ?? ''))('repository benchmark review tools (no API calls)', () => {
  it('prepares a plan, review template or measured policy from explicit input', async () => {
    const reportPath = process.env.REPO_BENCHMARK_REPORT ?? 'benchmark-results/repo-report.json'
    const reviewPath = process.env.REPO_BENCHMARK_REVIEWS ?? 'benchmark-results/repo-reviews.json'
    if (action === 'plan') {
      const config = configFromEnv(process.env)
      const schedule = trialSchedule(config)
      const availability = config.models.map((model) => {
        const provider = repoProvider(model)
        const key = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY' }[provider]
        return { model, provider, keyPresent: !!process.env[key] }
      })
      await save(process.env.REPO_BENCHMARK_PLAN ?? 'benchmark-results/repo-plan.json', { mode: 'plan-only', config, totalCalls: schedule.length, availability, suite: suiteManifest(), schedule, qualityGates: DEFAULT_GATES, paidCallsMade: 0 })
      expect(schedule.length).toBeGreaterThan(0)
      return
    }
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as BenchmarkReport
    if (action === 'review-template') {
      // Refuse to destroy a review a human already filled in.
      await mkdir(dirname(reviewPath), { recursive: true })
      await writeFile(reviewPath, `${JSON.stringify(reviewTemplate(report), null, 2)}\n`, { flag: 'wx' })
      await save(reviewPath.replace(/\.json$/, '') + '.md', reviewMarkdown(report))
      return
    }
    const reviews = JSON.parse(await readFile(reviewPath, 'utf8')) as BenchmarkReviews
    const gates = process.env.REPO_BENCHMARK_GATES ? JSON.parse(await readFile(process.env.REPO_BENCHMARK_GATES, 'utf8')) as RepoQualityGates : DEFAULT_GATES
    const selection = selectModels(report, reviews, gates)
    const selectionPath = process.env.REPO_BENCHMARK_SELECTION ?? 'benchmark-results/repo-selection.json'
    const policyPath = process.env.REPO_BENCHMARK_POLICY_OUTPUT ?? 'benchmark-results/repo-policy.json'
    await save(selectionPath, selection)
    await save(selectionPath.replace(/\.json$/, '') + '.md', selectionMarkdown(selection))
    // Empty policy supersedes stale local output. Production remains unchanged.
    await save(policyPath, selection.policy)
    expect(Object.keys(selection.policy.roles).length, 'No candidate qualified. Read the selection report; defaults must remain in use.').toBeGreaterThan(0)
  })
})
