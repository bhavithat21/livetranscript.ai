import assert from 'node:assert/strict'

/** Real browser/UI lifecycle; network replies are explicitly fixtures, not model quality measurements. */
export async function verifyRepositoryJourney(browser, base, output) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await context.tracing.start({ screenshots: true, snapshots: true })
  const page = await context.newPage(), errors = [], requests = { say: 0, plan: 0, review: 0, screen: 0 }
  page.on('pageerror', e => errors.push(e.message))
  let latestObservation = { files: [{ path: 'src/Rule.ts', language: 'typescript', startLine: 1, endOfFile: true, confidence: 1, lines: ['export function check(a: boolean, b: boolean) {', '  return a || b', '}'] }], visiblePaths: ['src/Rule.ts'], terminal: '', requirements: ['Both conditions must be true.'] }
  const plan = { summary: 'Browser fixture: require both conditions.', navigation: { path: 'src/Rule.ts', line: 2, symbol: 'check', reason: 'Review the predicate.' }, edits: [{ path: 'src/Rule.ts', before: 'return a || b', after: 'return a && b', reason: 'Both conditions are required.' }], checks: [], verify: ['npm test'], missingEvidence: [] }
  const reply = (events) => events.map(e => JSON.stringify(e)).join('\n') + '\n'
  await page.route('**/api/copilot/repo-live', async route => {
    const body = route.request().postDataJSON(), lane = body.lane
    assert.ok(['say', 'plan', 'review'].includes(lane)); requests[lane]++
    const model = 'browser-fixture-not-real-model'
    if (lane === 'say') await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: reply([{ type: 'start', model }, { type: 'delta', model, text: 'Browser fixture: I will inspect the observed predicate and its boundary tests.' }, { type: 'done' }]) })
    else {
      // Keep the code lane visibly pending after speech has completed.
      await new Promise(resolve => setTimeout(resolve, 1200))
      await route.fulfill({ status: 200, contentType: 'application/x-ndjson', body: reply([{ type: 'start', model }, { type: 'plan', model, plan }, { type: 'done' }]) }).catch(() => {})
    }
  })
  await page.route('**/api/copilot/repo-screen', route => { requests.screen++; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ model: 'browser-extraction-fixture', observation: latestObservation }) }) })
  await page.goto(base + '/interview/repository', { waitUntil: 'networkidle' })
  await page.getByRole('combobox', { name: 'Repository audio source' }).selectOption('none')
  await page.getByLabel('Task or initial question (optional with audio)').fill('Explain and fix the predicate so both conditions must be true.')
  await page.getByRole('checkbox').check()
  await page.getByRole('button', { name: 'Start session', exact: true }).click()
  await page.getByText('Browser fixture: I will inspect the observed predicate and its boundary tests.', { exact: true }).waitFor()
  assert.equal(await page.getByText('Browser fixture: require both conditions.', { exact: true }).count(), 0, 'Speech waited for the slow code lane')
  await page.getByText('Browser fixture: require both conditions.', { exact: true }).waitFor()
  const image = { name: 'synthetic-fixture.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT2kAAAAASUVORK5CYII=', 'base64') }
  await page.getByLabel('Upload repository screenshot').setInputFiles(image)
  await page.getByText('proposed', { exact: true }).waitFor()
  await page.waitForTimeout(3000)
  assert.equal(requests.say, 1, 'A new file or unchanged question restarted spoken guidance')
  assert.equal(requests.plan, 2, 'Unexpected repeated code requests for the same evidence')
  await page.getByLabel('Upload repository screenshot').setInputFiles(image)
  await page.waitForTimeout(2500)
  assert.equal(requests.say, 1); assert.equal(requests.plan, 2, 'Identical observations triggered an inference loop')
  await page.getByRole('button', { name: 'Pause guidance', exact: true }).click()
  latestObservation = { ...latestObservation, files: [{ ...latestObservation.files[0], lines: ['export function check(a: boolean, b: boolean) {', '  return a && b', '}'] }] }
  await page.getByLabel('Upload repository screenshot').setInputFiles(image)
  await page.getByText('matched', { exact: true }).waitFor()
  await page.waitForTimeout(1200)
  assert.equal(requests.say, 1); assert.equal(requests.review, 0, 'Paused guidance invoked a model')
  await page.getByRole('button', { name: 'End', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'Share IDE', exact: true }).count(), 0)
  await page.getByRole('textbox', { name: 'Repository feedback', exact: true }).fill('Keep this as a loop and edit-observation regression.')
  await page.getByRole('button', { name: 'Needs work', exact: true }).click()
  await page.getByText('1 feedback notes in this in-memory session.', { exact: true }).waitFor()
  await page.screenshot({ path: `${output}/browser-journey-ended.png`, fullPage: true })
  await context.tracing.stop({ path: `${output}/browser-journey-trace.zip` })
  assert.deepEqual(errors, [])
  await context.close()
  return { status: 'passed', kind: 'real UI with stubbed provider/extraction responses', actualModelCalls: 0, requests, speechIndependentOfCode: true, unchangedEvidenceNoLoop: true, editObservedWhilePaused: true, stoppedCaptureControlsRemoved: true }
}
