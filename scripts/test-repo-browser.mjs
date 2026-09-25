import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { verifyRepositoryJourney } from './repo-browser-journey.mjs'
const root = process.env.REPO_BROWSER_DIR
if (!root) throw new Error('REPO_BROWSER_DIR must identify the isolated Playwright install')
const require = createRequire(path.join(root, 'package.json'))
const { chromium } = require('playwright')
const base = process.env.REPO_BROWSER_BASE || 'http://127.0.0.1:3000'
if (new URL(base).hostname !== '127.0.0.1') throw new Error('Offline suite must target the local application')
const output = 'artifacts/repo-browser'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = [], errors = [], providerRequests = []
try {
  for (const [width, height] of [[375, 812], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080], [2560, 1440]]) {
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' })
    await context.tracing.start({ screenshots: true, snapshots: true })
    const page = await context.newPage()
    page.on('pageerror', error => errors.push({ width, message: error.message }))
    page.on('request', req => { if (/\/api\/(?:copilot\/(?:repo-live|repo-screen|answer|classify)|token)/.test(req.url())) providerRequests.push(req.url()) })
    await page.goto(base + '/interview/replay', { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Repository Replay Lab', exact: true }).waitFor()
    for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Next event', exact: true }).click()
    await page.getByText('Require current status and requested next status together.', { exact: true }).waitFor()
    const answer = page.getByTestId('repo-answer-column')
    let answerWidth = 0
    for (const theme of ['light', 'dark']) {
      if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark mode', exact: true }).click()
      const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
      const box = await answer.boundingBox()
      assert.ok(box && box.width >= Math.min(300, width - 60), `Answer column collapsed at ${width}/${theme}: ${JSON.stringify(box)}`)
      assert.ok(geometry.document <= width + 1 && geometry.body <= width + 1, `Horizontal overflow at ${width}/${theme}`)
      answerWidth = box.width
      await page.screenshot({ path: `${output}/${width}-${theme}-guidance.png`, fullPage: true })
    }
    await page.getByRole('button', { name: 'Replay all', exact: true }).click()
    await page.getByText('observed-pass', { exact: true }).waitFor()
    await page.getByText('matched', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Share IDE', exact: true }).count(), 0)
    await page.getByRole('textbox', { name: 'Repository feedback', exact: true }).fill('The incorrect Boolean operator should stay a named regression case.')
    await page.getByRole('button', { name: 'Needs work', exact: true }).click()
    await page.getByText('1 feedback notes in this in-memory session.', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'Export replay', exact: true }).isDisabled(), true)
    results.push({ width, height, answerWidth, themes: ['light', 'dark'], noHorizontalOverflow: true, replayReachedObservedPass: true, feedbackRetained: true })
    await context.tracing.stop({ path: `${output}/${width}-trace.zip` }); await context.close()
  }
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } }), page = await context.newPage()
  await page.goto(base + '/interview/repository', { waitUntil: 'networkidle' })
  assert.equal(await page.getByRole('button', { name: 'Start session', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Share IDE', exact: true }).count(), 0)
  const denied = await context.request.post(base + '/api/copilot/repo-live', { data: { lane: 'say', question: 'test', context: 'test' } })
  assert.equal(denied.status(), 401)
  await page.goto(base + '/interview/benchmarks', { waitUntil: 'networkidle' })
  assert.equal(await page.getByRole('button', { name: 'Run 3 model trials', exact: true }).isDisabled(), true)
  await context.close()
  assert.deepEqual(providerRequests, [], 'Offline replay unexpectedly requested model inference or microphone credentials')
  assert.deepEqual(errors, [])
  const journey = await verifyRepositoryJourney(browser, base, output)
  const report = { schema: 1, commit: process.env.GITHUB_SHA || 'local', status: 'passed', suite: 'actual application browser checks with synthetic replay and stubbed lifecycle journey', actualModelCalls: 0, note: 'Not an authenticated production interview or physical device test. No screenshot-diff baseline is claimed.', results, journey, errors }
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2))
} catch (e) { await writeFile(`${output}/failure.json`, JSON.stringify({ status: 'failed', message: String(e), results, errors, providerRequests }, null, 2)); throw e }
finally { await browser.close() }
