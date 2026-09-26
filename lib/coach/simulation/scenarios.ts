import type { Observation } from '../types'
import type { Scenario, SimCheck, SimEvent, SimState } from './types'
export const PATH = 'src/transition.ts'
export const BEFORE = '  return current === "PROCESSING" || next === "SHIPPED";'
export const AFTER = '  return current === "PROCESSING" && next === "SHIPPED";'
export function code(line = BEFORE, path = PATH): Observation {
  return { files: [{ path, language: 'typescript', startLine: 1, lines: ['export function allowed(current: string, next: string) {', line, '}'], confidence: 1, endOfFile: true }], visiblePaths: [PATH, 'test/transition.test.ts'], terminal: '', requirements: ['Only PROCESSING orders may become SHIPPED.'] }
}
const terminal = (text: string): Observation => ({ files: [], visiblePaths: [], terminal: text, requirements: [] })
const screen = (at: number, observation = code(), extras = {}): SimEvent => ({ at, label: 'Editor / terminal observation', action: { kind: 'screen', observation, ...extras } })
const say = (at: number, text: string, speaker = 1, id = `speech-${at}`, channel: 'call' | 'mic' = 'call'): SimEvent => ({ at, label: `${channel} voice ${speaker}: ${text}`, action: { kind: 'speech', id, text, speaker, channel } })
const control = (at: number, kind: 'pause' | 'resume' | 'end'): SimEvent => ({ at, label: `${kind} coach`, action: { kind } })
const Q = 'What is wrong with the transition condition?'
const Q2 = 'How should we test cancelled orders?'
const objective = 'Fix transition validation using the observed code and conversation.'
const check = (id: string, label: string, actual: unknown, expected: unknown): SimCheck => ({ id, label, actual: JSON.stringify(actual), expected: JSON.stringify(expected), passed: JSON.stringify(actual) === JSON.stringify(expected) })
const talk = (s: SimState) => s.requests.filter(r => r.lane === 'talk')
const healthy = (s: SimState) => [check('no-errors', 'No unhandled controller or detector errors', s.transportErrors, [])]

export const SCENARIOS: Scenario[] = [
  { id: 'import-not-navigation', name: 'Imported file is not a confirmed screen navigation', description: 'Importing a file adds exact source evidence, but does not mean the requested file is visibly open.', objective, duration: 6000,
    events: [screen(100), say(300, Q), screen(2200, code('  expect(allowed("PROCESSING", "SHIPPED")).toBe(true);', 'test/transition.test.ts'), { importOnly: true })],
    check: s => [...healthy(s), check('still-pending', 'Navigation waits for an actual screen observation', s.state.navigation?.status, 'pending'), check('import-evidence', 'Imported code is still available as evidence', s.state.files.some(f => f.path === 'test/transition.test.ts'), true)] },

  { id: 'conversation', name: 'Overlapping voices and fragmented questions', description: 'Setup chatter, an incomplete stem, candidate reasoning on the call, a microphone question, and a real interviewer follow-up.', objective, duration: 7000,
    events: [screen(100), say(200, 'Can you hear me?'), say(900, 'How would you'), say(1200, 'fix this transition condition?'), say(2100, 'I think we should require both states, and check invalid transitions.', 2), say(2300, 'Could we skip tests?', 0, 'my-mic', 'mic'), say(2900, Q2)],
    check: s => [...healthy(s), check('two-turns', 'Exactly two interviewer questions, no setup/candidate triggers', s.state.questions.length, 2), check('talk-count', 'One talk request per settled interviewer question', talk(s).length, 2), check('candidate-context', 'Next answer receives the candidate reasoning with its role', talk(s).at(-1)?.context.conversation?.some(t => t.role === 'candidate' && t.text.includes('require both')), true), check('candidate-not-tests', 'Spoken reasoning is not test evidence', s.state.tests.length, 0)] },
  { id: 'duplicates', name: 'Duplicate frames and final transcript corrections', description: 'Repeated identical screenshots and a punctuation-only ASR revision must not repeatedly bill the same question.', objective, duration: 15000,
    events: [screen(100), say(300, Q, 1, 'q'), ...Array.from({ length: 45 }, (_, i) => screen(1500 + i * 200)), say(5000, Q.replace('?', '.'), 1, 'q')].sort((a, b) => a.at - b.at),
    check: s => [...healthy(s), check('one-talk', 'Static transcript produces one spoken answer', talk(s).length, 1), check('one-guide', 'Duplicate observations produce one guide', s.requests.filter(r => r.lane === 'guide').length, 1)] },
  { id: 'latest-wins', name: 'Follow-up while an old answer is still streaming', description: 'A slow adapter deliberately ignores cancellation. Late words must never overwrite the new question.', objective, duration: 15000, faults: [{ lane: 'talk', occurrence: 1, behavior: 'slow', delayMs: 7000, ignoreAbort: true }],
    events: [screen(100), say(300, Q), say(1600, 'I will test both invalid directions.', 2), say(2200, Q2)],
    check: s => [...healthy(s), check('two-talk', 'New question starts without waiting for the old answer', talk(s).length, 2), check('new-context', 'Latest completed answer belongs to the new question', s.state.results.filter(r => r.lane === 'talk' && r.status === 'complete').at(-1)?.questionId, s.state.question?.id), check('cancel-old', 'Superseded result is not complete', s.state.results.find(r => r.lane === 'talk')?.status === 'complete', false)] },
  { id: 'stalled-adapter', name: 'Never-settling model adapter', description: 'Simulate a request that never resolves and ignores AbortSignal. The talk lane must release after its deadline.', objective, duration: 14000, faults: [{ lane: 'talk', occurrence: 1, behavior: 'hang', ignoreAbort: true }],
    events: [screen(100), say(300, Q)], check: s => [...healthy(s), check('settled-timeout', 'Talk result does not remain running after 9-second deadline', s.state.results.some(r => r.lane === 'talk' && r.status === 'running'), false), check('not-retried', 'Timeout does not automatically retry', talk(s).length, 1)] },
  { id: 'pause-resume', name: 'Pause during generation, then resume', description: 'Resume an interrupted question without asking it again. Completed lanes must not duplicate.', objective, duration: 7000, faults: [{ lane: 'talk', occurrence: 1, behavior: 'slow', delayMs: 3000 }],
    events: [screen(100), say(300, Q), control(1100, 'pause'), control(2600, 'resume')],
    check: s => [...healthy(s), check('resume-restarts', 'Interrupted talk is resumed exactly once', talk(s).length, 2), check('resumed-complete', 'Current spoken answer completes after resume', s.state.results.filter(r => r.lane === 'talk').at(-1)?.status, 'complete')] },
  { id: 'late-frame', name: 'Delayed extraction after a code edit', description: 'An older screenshot arrives after the new code. Old source must not replace the edit.', objective, duration: 6500,
    events: [screen(100), say(300, Q), screen(1900, code(AFTER)), screen(3000, code(), { capturedAt: 500 })],
    check: s => [...healthy(s), check('latest-source', 'Edited AND condition survives the late frame', s.state.files.find(f => f.path === PATH)?.fragments.flatMap(f => f.lines).includes(AFTER), true), check('late-frame-warning', 'Late observation is reported and ignored', s.state.warning?.includes('older screenshot'), true)] },
  { id: 'edit-and-tests', name: 'Wrong edit, correct edit, then stale tests', description: 'Observe a divergent edit, correct it, mark a test run, and edit again after green output.', objective, duration: 11000,
    events: [screen(100), say(300, Q), screen(2000, code('  return current === "PROCESSING" || next === "CANCELLED";')), screen(4000, code(AFTER)), { at: 5000, label: 'Explicit test-run marker', action: { kind: 'test', command: 'npm test' } }, screen(5300, terminal('Tests: 4 passed, 0 failed')), screen(6800, code('  return current === "SHIPPED" && next === "SHIPPED";'))],
    check: s => [...healthy(s), check('stale-green', 'Earlier pass is stale after a subsequent edit', s.state.tests[0]?.status, 'stale'), check('has-edits', 'Observed revisions increment code version', s.state.codeVersion >= 3, true)] },
  { id: 'hold', name: 'Interviewer hold and candidate disagreement', description: 'Interviewer says do not code yet. A candidate asking to implement cannot release that constraint.', objective, duration: 6000,
    events: [screen(100), say(200, 'Do not code yet. Explain the plan first.'), say(900, Q), say(1800, 'Okay, implement it now.', 2)],
    check: s => [...healthy(s), check('hold-kept', 'Candidate cannot release implementation hold', s.state.task.implementation, 'hold'), check('no-patches', 'No implementation patch is accepted during hold', s.state.patches.length, 0)] },
  { id: 'end', name: 'Stop while a request ignores cancellation', description: 'End the coach while an old answer is pending. Later screen, voice, and model events cannot change its ended state.', objective, duration: 14000, faults: [{ lane: 'talk', occurrence: 1, behavior: 'slow', delayMs: 6000, ignoreAbort: true }],
    events: [screen(100), say(300, Q), control(1000, 'end'), screen(2000, code(AFTER)), say(2500, Q2)],
    check: s => [...healthy(s), check('ended', 'Session stays ended', s.state.status, 'ended'), check('one-question', 'Post-end questions are ignored', s.state.questions.length, 1), check('old-code', 'Post-end screenshots are ignored', s.state.codeVersion, 0), check('no-completion', 'Late model answer is not completed', s.state.results.some(r => r.lane === 'talk' && r.status === 'complete'), false)] },
  { id: 'invalid-patch', name: 'Hallucinated patch target', description: 'A model returns a patch for an unseen file. The actual guidance validator must reject it.', objective, duration: 6000, faults: [{ lane: 'guide', occurrence: 1, behavior: 'unsupported-patch' }],
    events: [screen(100), say(300, Q)],
    check: s => [...healthy(s), check('reject-patch', 'Unsupported patch fails validation', s.state.results.find(r => r.lane === 'guide')?.status, 'failed'), check('no-invention', 'Unseen patch is not added to repository state', s.state.patches.length, 0)] },
  { id: 'failed-no-loop', name: 'Provider failure and explicit retry', description: 'First talk request fails; repeated input cannot retry it. Only an explicit retry starts the second request.', objective, duration: 7000, faults: [{ lane: 'talk', occurrence: 1, behavior: 'fail' }],
    events: [screen(100), say(300, Q), screen(1900), say(2200, Q, 1, 'speech-300'), { at: 3800, label: 'User explicitly retries talk', action: { kind: 'retry', lane: 'talk' } }],
    check: s => [...healthy(s), check('two-attempts', 'Exactly one failure plus one explicit retry', talk(s).length, 2), check('no-auto-retry', 'Second attempt begins only at the explicit retry', talk(s)[1]?.at, 3800), check('retry-completes', 'Explicit retry completes', s.state.results.filter(r => r.lane === 'talk').at(-1)?.status, 'complete')] },
  { id: 'roles', name: 'Mixed system audio and interviewer selection', description: 'Both voices arrive through system audio. Only the explicitly selected interviewer may trigger questions; other speech stays in context.', objective, duration: 6000,
    events: [screen(100), say(300, Q), say(1800, 'Why not just skip the tests?', 2), { at: 2400, label: 'Reaffirm interviewer voice', action: { kind: 'interviewer', speaker: 1 } }, say(2800, 'I have run the tests and they passed.', 2)],
    check: s => [...healthy(s), check('one-trigger', 'Candidate questions and role refresh do not retrigger', talk(s).length, 1), check('no-false-pass', 'Candidate pass claim does not create test evidence', s.state.tests.length, 0)] },
]
