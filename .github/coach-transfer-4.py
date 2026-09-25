# Applies the reviewed local changes only to their exact source preimages.
# Temporary build transfer; not part of the application or final feature branch.
from pathlib import Path
import hashlib, os
ROOT = Path(os.environ['TARGET_ROOT']).resolve()
def put(name, old_hash, new_hash, operations):
    path = ROOT / name
    assert path.resolve().is_relative_to(ROOT), 'Invalid target path'
    old = path.read_bytes() if path.exists() else None
    assert (hashlib.sha256(old).hexdigest() if old is not None else None) == old_hash, 'Source mismatch: ' + name
    lines = (old.decode() if old is not None else '').splitlines(keepends=True)
    for start, end, content in reversed(operations):
        lines[start:end] = content.splitlines(keepends=True)
    data = ''.join(lines).encode()
    assert hashlib.sha256(data).hexdigest() == new_hash, 'Transfer mismatch: ' + name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(name, new_hash)

put('scripts/test-repo-coach.mjs', 'b09d4459d1ab831358860e4974a8566df3e8684a5584880a03d8a0e10ca425ae', '2c9151eb598b933b70cb7ff56d598639aa6b76b4a060b186aded8c9dac768ce4', [
    (220, 220, r"""
// Regression cases found during integration review; these execute real reducers
// and schedulers, with deterministic transport fixtures rather than live models.
test('overlapping re-captures keep a canonical code key independent of chunk boundaries', () => {
  let s = see(start(), [file(['a', 'b', 'c', 'd'])])
  const key = s.files[0].contentKey
  s = see(s, [file(['b', 'c'], 2, { endOfFile: false })])
  assert.equal(s.files[0].contentKey, key)
  assert.equal(s.files[0].version, 1)
  assert.ok(lineMap(s.files[0]).get(2).sources.length > 1)
})
test('a delayed screenshot cannot overwrite a more recent edit', () => {
  let s = base(); const oldAt = serial * 100
  s = see(s, [file(['new current code'])]); const version = s.codeVersion
  s = apply(s, { type: 'screen.observed', capturedAt: oldAt, origin: 'screen', observation: observation([file(['older screenshot'])]) })
  assert.equal(lineMap(s.files[0]).get(1).text, 'new current code')
  assert.equal(s.codeVersion, version); assert.match(s.warning, /older screenshot/)
})
test('newly observed requirements invalidate spoken guidance as well as code guidance', () => {
  let s = base(); const packet = buildContext(s), requestId = id()
  s = apply(s, { type: 'result.start', lane: 'talk', requestId, questionId: s.question.id, evidenceVersion: s.evidenceVersion, contextKey: packet.contextKey })
  const version = s.task.version
  s = see(s, [], { requirements: ['The cancelled state is terminal and must remain unchanged.'] })
  assert.equal(s.task.version, version + 1)
  assert.equal(s.results.find(row => row.id === requestId).status, 'stale')
})
test('current view ranges are explicit and validated, not inferred from the context order', () => {
  const s = see(base(), [file(['return 1;'], 12, { endOfFile: false })])
  const packet = parseContext(buildContext(s))
  assert.equal(packet.visibleView.files[0].path, 'src/TrackingService.ts')
  assert.equal(packet.visibleView.files[0].startLine, 12)
  assert.equal(packet.visibleView.origin, 'screen')
  assert.throws(() => parseContext({ ...packet, visibleView: { ...packet.visibleView, files: [{ path: 'not-observed.ts', startLine: 1, endLine: 2 }] } }))
})
test('switching between already observed files updates the view without inventing a code edit', () => {
  let s = see(base(), [file(['function other() {}'], 1, { path: 'src/Other.ts' })])
  const version = s.evidenceVersion, code = s.codeVersion
  s = see(s, [file(['export function accepts(current, next) {', '  return current === "PROCESSING" || next === "SHIPPED";', '}'])])
  assert.equal(s.evidenceVersion, version + 1); assert.equal(s.codeVersion, code)
  assert.equal(buildContext(s).visibleView.files[0].path, 'src/TrackingService.ts')
})
test('curly apostrophes preserve interviewer hold intent and explicit later instructions release test deferral', () => {
  let s = apply(base(), { type: 'speech.final', speaker: 'interviewer', text: 'Don’t code yet. Don’t worry about tests.' })
  assert.equal(s.task.implementation, 'hold'); assert.ok(s.task.constraints.some(value => value.includes('defer tests')))
  s = apply(s, { type: 'speech.final', speaker: 'interviewer', text: 'Okay, implement it. Now run the tests.' })
  assert.equal(s.task.implementation, 'allowed'); assert.equal(s.task.constraints.some(value => value.includes('defer tests')), false)
})
test('changing the task retires unrelated patch proposals and navigation', () => {
  const s = apply(propose(base()), { type: 'task.update', objective: 'Investigate a different requirement.', constraints: [] })
  assert.equal(s.patches.length, 0); assert.equal(s.patchReviews.length, 0); assert.equal(s.navigation, null)
})
for (const [output, status, passed, failed] of [
  ['[INFO] Tests run: 29, Failures: 2, Errors: 1, Skipped: 0', 'observed-fail', 26, 3],
  ['[INFO] Tests run: 29, Failures: 0, Errors: 0, Skipped: 2', 'observed-pass', 27, 0],
  ['Passed! - Failed: 0, Passed: 12, Skipped: 0, Total: 12', 'observed-pass', 12, 0],
  ['Failed! - Failed: 1, Passed: 11, Skipped: 0, Total: 12', 'observed-fail', 11, 1],
  ['OK (14 tests)', 'observed-pass', 14, 0],
  ['Ran 5 tests in 0.004s\n\nOK', 'observed-pass', 5, 0],
  ['OK', 'incomplete', null, null],
  ['# pass 27', 'incomplete', 27, null],
  ['Tests: 27 passed, 0 failed\nRunning tests', 'running', null, null],
  ['Tests: 27 passed, 0 failed\nRunning tests\nTests: 2 failed, 3 passed', 'observed-fail', 3, 2],
  ['test result: ok. 8 passed; 0 failed; 0 ignored', 'observed-pass', 8, 0],
  ['const message = "Tests: 27 passed, 0 failed";', 'incomplete', null, null],
]) test(`fresh, toolchain-aware output: ${output}`, () => assert.deepEqual(parseTestOutput(output), { status, passed, failed }))

test('constraint changes refresh the speech lane immediately, without waiting for a new screenshot', async () => {
  const calls = []
  const controller = new CoachController(async (lane, packet, options) => { calls.push({ lane, implementation: packet.task.implementation }); options.delta('Explain before editing.', 'fixture'); return { model: 'fixture', guidance: lane === 'talk' ? null : emptyGuide() } }, Date.now, id)
  try {
    controller.start('practice', 'Investigate the task.'); controller.question('What should I change?'); await wait(10)
    controller.speech('Don’t code yet. Explain first.'); await wait(10)
    assert.deepEqual(calls.filter(row => row.lane === 'talk').map(row => row.implementation), ['allowed', 'hold'])
  } finally { controller.dispose() }
})
test('replay checkpoints never include future files or call models while seeking', () => {
  let calls = 0
  const controller = new CoachController(async () => { calls++; return { model: 'fixture', guidance: null } }, Date.now, id)
  const events = [event({ type: 'session.start', permission: 'practice', objective: 'Inspect code' }), event({ type: 'question.new', original: 'Where should I look?', text: 'Where should I look?' }), event({ type: 'screen.observed', origin: 'screen', observation: observation([file(['observed at third event'])]) })]
  const raw = JSON.stringify({ format: 'livetranscript-repo-replay-v1', sessionId: 's', truncated: false, events,
    evaluations: [{ id: 'original-result', lane: 'talk', text: 'Old generated answer', model: 'fixture' }],
    feedback: [{ resultId: 'original-result', verdict: 'needs-work', note: 'Mention the missing caller.' }] })
  try {
    controller.loadReplay(raw); assert.equal(controller.getSnapshot().files.length, 1)
    controller.seekReplay(2); assert.equal(controller.getSnapshot().files.length, 0)
    const packet = buildContext(controller.getSnapshot())
    assert.equal(JSON.stringify(packet).includes('Old generated answer'), false)
    assert.equal(JSON.stringify(packet).includes('Mention the missing caller'), false)
    assert.equal(controller.getReplayInfo().references[0].note, 'Mention the missing caller.')
    controller.seekReplay(3); assert.equal(controller.getSnapshot().files.length, 1); assert.equal(calls, 0)
    assert.throws(() => controller.seekReplay(4)); assert.throws(() => controller.seekReplay(0))
  } finally { controller.dispose() }
})

test('blinking caret does not prevent the first keyframe or a persistent small edit', () => {
  const gate = new KeyframeGate(400, 0)
  const a = { fingerprint: 'base', pixels: new Uint8Array(256), width: 16, height: 16 }
  const blink = { ...a, fingerprint: 'caret', pixels: a.pixels.slice() }; blink.pixels[0] = blink.pixels[1] = 128
  assert.equal(gate.sample(a, 0).capture, false)
  assert.equal(gate.sample(blink, 250).capture, false)
  assert.equal(gate.sample(a, 500).capture, true); gate.finish(a, true)
  assert.equal(gate.sample(blink, 750).capture, false)
  assert.equal(gate.sample(a, 1000).capture, false)
  const edit = { ...a, fingerprint: 'edit', pixels: a.pixels.slice() }; edit.pixels[170] = edit.pixels[171] = 255
  const editBlink = { ...edit, fingerprint: 'edit-and-caret', pixels: edit.pixels.slice() }; editBlink.pixels[0] = editBlink.pixels[1] = 128
  assert.equal(gate.sample(edit, 1250).capture, false)
  assert.equal(gate.sample(editBlink, 1500).capture, false)
  assert.equal(gate.sample(edit, 1750).capture, true)
})
test('invalid local dimensions cannot trigger a model capture', () => {
  const gate = new KeyframeGate()
  for (const dimensions of [{ width: 0, height: 0 }, { width: -8, height: -8 }, { width: 641, height: 1 }]) assert.throws(() => gate.sample({ ...dimensions, pixels: new Uint8Array(Math.max(0, dimensions.width * dimensions.height)), fingerprint: 'fixture' }, 0))
})
test('a slower old source attachment cannot replace a newer selected screen', async () => {
  let finishStop, oldStopped = 0
  const observer = new ScreenObserver(() => {}, async () => observation())
  await observer.attach({ signal: async () => null, image: async () => null, stop: () => new Promise(resolve => { finishStop = resolve }) }, 'browser')
  const oldAttach = observer.attach({ signal: async () => null, image: async () => null, stop: () => { oldStopped++ } }, 'browser')
  await observer.attach({ signal: async () => null, image: async () => 'data:image/jpeg;base64,/9j/', stop() {} }, 'native')
  finishStop(); await oldAttach
  assert.equal(observer.getSnapshot().source, 'native'); assert.equal(oldStopped, 1)
  observer.dispose()
})


test('a passing Go package cannot erase an earlier failure from the same run', () => {
  assert.equal(parseTestOutput('FAIL app/status 0.02s\nok app/controller 0.04s').status, 'observed-fail')
  assert.equal(parseTestOutput('FAIL app/status 0.02s\nRunning tests\nok app/status 0.04s').status, 'observed-pass')
})
"""),
])
