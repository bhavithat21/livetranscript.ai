import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sha256, type VisionReport } from './report'
import { compileVisionPolicy, visionReviewTemplate } from './select'
import type { RepoQualityGates } from '../../lib/repo/modelPolicy'
import { visionFixtures } from './fixtures'
import { renderVisionFixture } from './render'

describe('offline vision report review and selection', () => {
  it.skipIf(process.env.VISION_BENCHMARK_RENDER !== '1')('renders inspection images without calling a model', async () => {
    const directory = resolve(process.env.VISION_BENCHMARK_ASSETS ?? 'vision-benchmark-fixtures')
    await mkdir(directory, { recursive: true })
    const manifest = []
    for (const fixture of visionFixtures) {
      const rendered = await renderVisionFixture(fixture)
      const path = resolve(directory, `${fixture.id}.png`)
      await writeFile(path, rendered.png)
      manifest.push({ fixture: fixture.id, purpose: fixture.purpose, sha256: rendered.sha256, path, expected: fixture.expected })
    }
    await writeFile(resolve(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
  })
  it.skipIf(process.env.VISION_BENCHMARK_PREPARE_REVIEW !== '1')('prepares an unapproved review tied to the report', async () => {
    const reportText = await readFile(process.env.VISION_BENCHMARK_REPORT ?? 'vision-benchmark-report.json', 'utf8')
    const path = resolve(process.env.VISION_BENCHMARK_REVIEW ?? 'vision-benchmark-review.json')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, JSON.stringify(visionReviewTemplate(reportText), null, 2), { flag: 'wx' })
  })
  it.skipIf(process.env.VISION_BENCHMARK_SELECT !== '1')('selects the fastest qualified actual model without changing deployment settings', async () => {
    const reportText = await readFile(process.env.VISION_BENCHMARK_REPORT ?? 'vision-benchmark-report.json', 'utf8')
    const reviewText = await readFile(process.env.VISION_BENCHMARK_REVIEW ?? 'vision-benchmark-review.json', 'utf8')
    const report = JSON.parse(reportText) as VisionReport
    for (const image of report.images) {
      expect(sha256(await readFile(image.path)), `Rendered image changed: ${image.fixture}`).toBe(image.sha256)
    }
    const gates = process.env.VISION_BENCHMARK_GATES ? JSON.parse(process.env.VISION_BENCHMARK_GATES) as RepoQualityGates : undefined
    const result = compileVisionPolicy(reportText, reviewText, gates)
    const output = resolve(process.env.VISION_BENCHMARK_SELECTION ?? 'vision-benchmark-selection.json')
    await mkdir(dirname(output), { recursive: true })
    await writeFile(output, JSON.stringify(result, null, 2))
    expect(result.policy, 'No reviewed vision candidate passed every quality/latency gate; routing remains unchanged').not.toBeNull()
  })
})
