import { describe, expect, it } from 'vitest'
import { KeyframeGate, type FrameSignal } from './keyframes'
import { CoachController, httpCoachTransport } from './controller'
import { CoachRequestError } from './errors'
import { emptyCoach, intentFromSpeech } from './state'
import { questionCandidates } from '../copilot/questionDetection'
import { VirtualClock } from './simulation/clock'
import { coachGeneration, GUIDANCE_SCHEMA } from './generation'
import { comparisonExcerpt, roundReview } from './roundReview'
import { nextInspection } from './context'
import type { ContextPacket } from './types'
import { vi } from 'vitest'

const moving = (tick: number): FrameSignal => {
  const pixels = new Uint8Array(32 * 16)
  for (let y = 0; y < 8; y++) for (let x = 0; x < 24; x++) pixels[y * 32 + x] = 24 + (tick * 37) % 230
  pixels[31] = pixels[63] = 24 + Math.floor(tick / 20) * 24 // persistent code edits outside the moving tiles
  return { fingerprint: String(tick), pixels, width: 32, height: 16 }
}
describe('production video failures', () => {
  it('bounds capture starvation despite continuously moving video tiles', () => {
    const gate = new KeyframeGate(), captures: number[] = []
    for (let tick = 0; tick <= 120; tick++) {
      const sample = moving(tick), now = tick * 250
      if (gate.sample(sample, now).capture) { captures.push(now); gate.finish(sample, true) }
    }
    expect(captures[0]).toBeLessThanOrEqual(4000)
    expect(captures.length).toBeGreaterThanOrEqual(6)
    expect(captures.every((at, i) => !i || at - captures[i - 1] >= 1500)).toBe(true)
  })
  it('does not queue extractions or send unchanged screens on a freshness timer', () => {
    const gate = new KeyframeGate(0), sample = moving(1)
    expect(gate.sample(sample, 0).capture).toBe(true)
    expect(gate.sample(moving(2), 50_000).reason).toBe('busy')
    gate.finish(sample, true)
    expect(gate.sample(sample, 100_000).reason).toBe('unchanged')
    gate.reset()
    expect(gate.sample(sample, 100_001).capture).toBe(true)
  })
  it.each([
    "I was gonna say, for the sake of the interview, let's assume that we know it's this service Right?",
    'The work takes ten seconds, correct?', 'Right?', 'Okay?',
  ])('keeps agreement tags as context, not questions: %s', text => expect(questionCandidates(text)).toEqual([]))
  it('detects the actual interviewer investigation request after a conversational preface', () => {
    const request = "I would like to see how you use this AI agent to try to figure out what's taking the most amount of time."
    expect(questionCandidates(`We already know this is the service, so yeah, ${request}`).at(-1)?.question).toBe(request)
    expect(questionCandidates('The interviewer said "I would like you to implement it."')).toEqual([])
  })
  it('preserves the required expensive operation across later questions', () => {
    const initial = emptyCoach('s').task
    const task = intentFromSpeech(initial, "There is nothing we can do to speed it up. It has to take ten seconds.")
    expect(task.constraints.join(' ')).toContain('speed it up')
    expect(task.constraints.join(' ')).toContain('ten seconds')
    expect(intentFromSpeech(task, 'How would you investigate this?').constraints).toEqual(task.constraints)
    expect(intentFromSpeech(initial, 'Can we remove the slow operation?').constraints).toEqual([])
  })
  it('commits constraints atomically before dispatch and cancels a superseded response', async () => {
    const packets: ContextPacket[] = [], signals: AbortSignal[] = [], clock = new VirtualClock()
    let id = 0
    const controller = new CoachController(async (_lane, packet, options) => { packets.push(packet); signals.push(options.signal); return new Promise(() => {}) }, () => clock.now(), () => `e${++id}`, 's', clock)
    controller.start('practice', 'Explain this operation')
    controller.question('How can this finish?', 'The operation has to take ten seconds.')
    expect(packets[0].task.constraints.join(' ')).toContain('ten seconds')
    controller.question('How can this finish?', 'Do not modify the API.')
    expect(signals[0].aborted).toBe(true)
    expect(packets[1].task.constraints.join(' ')).toContain('public APIs')
    controller.dispose()
    await clock.advance(10_000)
    expect(controller.getMetrics().activeRequests).toBe(0)
  })
  it('keeps model limits and reasoning separate for immediate speech and code analysis', () => {
    expect(coachGeneration('talk', 'claude-sonnet-5')).toMatchObject({ thinking: 'disabled', maxTokens: 640 })
    expect(coachGeneration('guide', 'claude-sonnet-5')).toMatchObject({ thinking: 'adaptive', effort: 'medium', schema: GUIDANCE_SCHEMA })
    expect(coachGeneration('talk', 'claude-haiku-4-5')).not.toHaveProperty('effort')
    expect(coachGeneration('guide', 'custom-model')).not.toHaveProperty('schema')
  })
  it('does not request a second unread basename for already observed qualified code', () => {
    const state = emptyCoach('s'), path = 'src/service/Report.java'
    state.knownPaths = ['Report.java', path]
    state.files = [{ path, version: 1, language: 'java', retired: [], contentKey: 'v1', lastSeen: 1, fragments: [{ path, language: 'java', confidence: 1, sources: ['s'], startLine: 8, lines: ['return report;'], endOfFile: false }] }]
    state.navigation = { path: 'Report.java', startLine: 1, endLine: 1, reason: 'Unread', symbol: '', status: 'pending', requestedAfter: 1 }
    expect(nextInspection(state)?.path).toBe(path)
    state.knownPaths.push('other/Report.java')
    expect(nextInspection(state)?.path).toBe('Report.java') // ambiguity preserved
  })
  it('keeps model output separate from speech in a bounded comparison record', () => {
    const state = emptyCoach('s')
    state.questions = [{ id: 'q', text: 'Explain concurrency', original: '', at: 1 }]
    const record = roundReview(state)
    expect(record).toContain('Not a full-round completion claim')
    const paired = comparisonExcerpt('Human '.repeat(50_000), record.repeat(2000))
    expect(paired.transcript.length).toBeLessThanOrEqual(40_000)
    expect(paired.transcript).toContain('NOT CANDIDATE SPEECH')
    expect(paired.coverage).toContain('not candidate failures')
  })
  it('preserves safe evidence errors without displaying untrusted provider text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"type":"error","code":"evidence","error":"secret provider response"}\n')))
    try {
      await expect(httpCoachTransport('guide', {} as ContextPacket, { signal: new AbortController().signal, delta: () => {} })).rejects.toEqual(new CoachRequestError('evidence'))
    } finally { vi.unstubAllGlobals() }
  })
})
