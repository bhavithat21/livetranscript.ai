import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extractScreenEvidence, ScreenExtractionError } from '../../lib/repo/screenProvider'
import type { ScreenObservation } from '../../lib/repo/screenEvidence'
import { visionFixtures } from './fixtures'
import { renderVisionFixture } from './render'
import { visionRunConfiguration, visionSuiteSha256, type VisionReport, type VisionRow } from './report'
import { scoreVisionFixture } from './score'

describe.skipIf(process.env.VISION_BENCHMARK_LIVE !== '1')('live repository screenshot benchmark', () => {
  it('measures actual image extraction with the production provider, prompt and schema', async () => {
    const configuration = visionRunConfiguration()
    expect(Boolean(process.env.ANTHROPIC_API_KEY), 'ANTHROPIC_API_KEY is required; no paid calls were made').toBe(true)
    const output = resolve(process.env.VISION_BENCHMARK_REPORT ?? 'vision-benchmark-report.json')
    const assetDirectory = `${output}.images`
    await mkdir(dirname(output), { recursive: true })
    await mkdir(assetDirectory, { recursive: true })
    const images = new Map<string, Awaited<ReturnType<typeof renderVisionFixture>>>()
    const report: VisionReport = {
      version: 1, purpose: 'vision', benchmarkId: `repo-vision-${new Date().toISOString()}`, measuredAt: new Date().toISOString(),
      suiteSha256: visionSuiteSha256(), complete: false, ...configuration, images: [], rows: [],
      limits: 'Eight synthetic editor frames, sequential isolated image requests. Does not measure real browser ingestion, arbitrary fonts, camera photos, speech, end-to-end latency or full repository correctness. Exact-frame scores are strict visible-ground-truth checks, not general vision rankings. Images and raw responses require review before routing. No token prices or monetary costs are assumed.',
    }
    const save = () => writeFile(output, JSON.stringify(report, null, 2))
    // Render all inputs before the first paid request. PNG hashes make environment-specific rasterization visible.
    for (const fixture of visionFixtures) {
      const rendered = await renderVisionFixture(fixture)
      images.set(fixture.id, rendered)
      const path = resolve(assetDirectory, `${fixture.id}.png`)
      await writeFile(path, rendered.png)
      report.images.push({ fixture: fixture.id, sha256: rendered.sha256, path })
    }
    await save()
    // Repetitions rotate candidate order to reduce first/last-candidate timing bias. Requests remain sequential.
    for (let repetition = 1; repetition <= configuration.repetitions; repetition++) {
      const offset = (repetition - 1) % configuration.candidates.length
      const candidates = [...configuration.candidates.slice(offset), ...configuration.candidates.slice(0, offset)]
      for (const requestedModel of candidates) {
        const previous = new Map<string, ScreenObservation>()
        for (const fixture of visionFixtures) {
          const image = images.get(fixture.id)!
          const started = performance.now()
          const row: VisionRow = { requestedModel, fixture: fixture.id, repetition, imageSha256: image.sha256, latencyMs: 0 }
          try {
            const result = await extractScreenEvidence({ model: requestedModel, image: { mediaType: 'image/png', data: image.png.toString('base64') } })
            row.latencyMs = Math.round(performance.now() - started)
            Object.assign(row, { actualModel: result.model, observation: result.observation, raw: result.raw, ...(result.usage ? { usage: result.usage } : {}) })
            row.score = scoreVisionFixture(fixture, result.observation, fixture.previousFixture ? previous.get(fixture.previousFixture) : undefined)
            previous.set(fixture.id, result.observation)
          } catch (error) {
            row.latencyMs = Math.round(performance.now() - started)
            // Never persist provider bodies, headers or credentials in a failed-row diagnostic.
            row.error = error instanceof ScreenExtractionError ? error.message : 'Provider failed or timed out'
            if (error instanceof ScreenExtractionError) {
              if (error.model) row.actualModel = error.model
              if (error.usage) row.usage = error.usage
            }
          }
          report.rows.push(row)
          await save()
        }
      }
    }
    report.complete = true
    await save()
    expect(report.rows.some((row) => row.observation), 'No extraction succeeded; inspect the report and provider access').toBe(true)
  })
})
