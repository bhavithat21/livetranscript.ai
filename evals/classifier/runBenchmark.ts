import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localClassify } from '../../lib/copilot/localClassify'
import { classifyQuestion } from '../../lib/copilot/serverClassifier'
import { classifierFixtures } from './fixtures'
import { CLASSIFIER_VARIANTS, classifierRunConfiguration, classifierSuiteSha256, classifierSummary, proposeClassifier, type ClassifierRow } from './report'

// Excluded from normal test discovery and separately opted in. A normal unit-test
// or build command cannot spend classifier API credits.
describe.skipIf(process.env.CLASSIFIER_BENCHMARK_LIVE !== '1')('live local-first classifier comparison', () => {
  it('compares legacy and Jev plus legacy fallback on identical utterances', async () => {
    const configuration = classifierRunConfiguration()
    const output = resolve(process.env.CLASSIFIER_BENCHMARK_REPORT ?? 'classifier-benchmark-report.json')
    const frozenEnv = { ...process.env, COPILOT_CLASSIFIER_MODEL: configuration.requestedModels.legacy, TYPESAFE_MODEL: configuration.requestedModels.jev }
    const implementationHash = createHash('sha256')
    for (const path of ['lib/copilot/localClassify.ts', 'lib/copilot/serverClassifier.ts', 'lib/copilot/classification.ts']) {
      implementationHash.update(path).update(await readFile(resolve(path)))
    }
    const rows: ClassifierRow[] = []
    const startedAt = new Date().toISOString()
    const report = {
      version: 1, purpose: 'classification', benchmarkId: `local-first-classifier-${startedAt}`, measuredAt: startedAt,
      suiteSha256: classifierSuiteSha256(), implementationSha256: implementationHash.digest('hex'),
      complete: false, status: configuration.errors.length ? 'blocked' : 'running', ...configuration,
      fixtures: classifierFixtures, variants: { legacy: 'production local classifier, then legacy network classifier', jev: 'production local classifier, then Jev, then legacy fallback on uncertainty/error' },
      limits: 'Synthetic labeled utterances measure production classification functions, including provider latency and fallback. Timings exclude browser-to-server HTTP/authentication overhead, question detection, speech, answer generation and web search. Local-first hits and network cases are reported separately. Repetitions do not create independent utterances. Usage is a provider-reported subtotal; missing usage is unknown, not free. No model prices, dollar costs, overall-product speedup or statistical significance are inferred. No production selection is changed.',
      rows, summary: classifierSummary(rows), proposal: proposeClassifier(rows, configuration.repetitions, false),
    }
    await mkdir(dirname(output), { recursive: true })
    const save = async () => {
      report.summary = classifierSummary(rows)
      report.proposal = proposeClassifier(rows, configuration.repetitions, report.complete)
      await writeFile(output, JSON.stringify(report, null, 2))
    }
    await save()
    expect(configuration.errors, 'Benchmark blocked; inspect the saved report for configuration requirements').toEqual([])
    // All requests are sequential. Rotate which variant runs first per repetition
    // to reduce consistently favoring the first or last provider connection.
    for (let repetition = 1; repetition <= configuration.repetitions; repetition++) {
      const variants = repetition % 2 ? [...CLASSIFIER_VARIANTS] : [...CLASSIFIER_VARIANTS].reverse()
      for (const fixture of classifierFixtures) for (const variant of variants) {
        const started = performance.now()
        const row: ClassifierRow = {
          variant, repetition, fixture: fixture.id, category: fixture.category, expected: fixture.expected,
          path: 'local', elapsedMs: 0, result: null, attempts: [],
        }
        try {
          const local = localClassify(fixture.utterance)
          if (local) row.result = { ...local, confidence: 1 }
          else {
            row.path = 'network'
            const response = await classifyQuestion(fixture.utterance, { provider: variant, env: frozenEnv })
            row.result = response.result
            row.attempts = response.attempts.map((attempt) => ({
              ...attempt,
              requestedModel: attempt.provider === 'jev' ? configuration.requestedModels.jev : configuration.requestedModels.legacy,
              // On errors/unconfigured calls, attempt.model may still be merely
              // the requested ID. Do not misrepresent it as a returned identity.
              returnedModel: attempt.outcome === 'accepted' || attempt.outcome === 'uncertain' ? attempt.model : null,
            }))
          }
        } catch {
          row.error = 'Classification failed unexpectedly; provider bodies are not stored'
        }
        row.elapsedMs = Math.round((performance.now() - started) * 1_000) / 1_000
        rows.push(row)
        await save()
      }
    }
    report.complete = true
    report.status = 'completed'
    await save()
    for (const provider of ['jev', 'legacy'] as const) {
      expect(rows.some((row) => row.attempts.some((attempt) => (provider === 'jev' ? attempt.provider === 'jev' : attempt.provider !== 'jev') && attempt.returnedModel)), `${provider} returned no valid response; inspect the report before making any comparison`).toBe(true)
    }
  })
})
