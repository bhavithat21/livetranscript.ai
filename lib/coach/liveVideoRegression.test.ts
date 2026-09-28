import { describe, expect, it, vi } from 'vitest'
import { CoachController, type CoachTransport } from './controller'
import { questionCandidates } from '../copilot/questionDetection'
import { ProactiveEngine, type QuestionInput } from '../copilot/proactiveEngine'
import { VirtualClock } from './simulation/clock'
import { taskRequirements } from '../repo/evidenceText'
import { coachGeneration } from './generation'
import type { Observation } from './types'
import { resultCurrent, sameSpokenTask } from './state'

const screen = (line = 'return report;', confidence = 0.92, terminal = ''): Observation => ({
  files: [{ path: 'Service.java', language: 'java', startLine: 8, lines: [line], confidence, endOfFile: false }],
  visiblePaths: ['Service.java'], requirements: [], terminal,
})

describe('failures observed during the real YouTube run', () => {
  it('captures the actual ask after its spoken introduction, not the earlier statement', async () => {
    const clock = new VirtualClock(), asked: string[] = []
    let input: QuestionInput = { text: 'But what we do care about is that this process is taking a long time.', endOfTurn: true }
    const engine = new ProactiveEngine(() => input, q => { asked.push(q) }, {}, clock)
    engine.start(); await clock.advance(1000)
    expect(asked).toEqual([])
    input = { text: input.text + ' So the first question I have is how would you improve this, and how would you fix this.', endOfTurn: true }
    await clock.advance(900)
    expect(asked).toEqual(['how would you improve this, and how would you fix this.'])
    input = { text: input.text + ' Turn boundary. Candidate response. Turn boundary. We wanna like, what are our options knowing the work cannot be sped up?', endOfTurn: true }
    await clock.advance(900)
    expect(asked.at(-1)).toBe('what are our options knowing the work cannot be sped up?')
    engine.stop()
  })
  it('does not lose a complete request to a trailing conversational handoff', () => {
    const text = "So, yeah, I'd like to see how you use this AI agent to find the slow step, and, yeah, we can then go from."
    expect(questionCandidates(text).at(-1)?.question).toBe("I'd like to see how you use this AI agent to find the slow step")
    expect(questionCandidates('He asked, the first question I have is how would you fix this.')).toEqual([])
    expect(questionCandidates('What we need is an asynchronous response.')).toEqual([])
    expect(questionCandidates('How would you implement this with')).toEqual([])
    expect(questionCandidates('What are some ways that we can still.')).toEqual([])
    expect(questionCandidates('What are some ways that we can still prevent the timeout?').at(-1)?.question).toContain('prevent the timeout')
  })
  it('keeps the full task and removes video promotion and clipped duplicate readings', () => {
    const full = "You're given the following gRPC service that generates a report."
    expect(taskRequirements(['Ace your interviews with our interview prep course: https://example.test', 'In this video, we unpack the process ...more', '50K views 9 months ago #ai #aitools', full, full.slice(0, 46), '> Preserve the expensive work', 'Preserve the expensive work']))
      .toEqual([full, 'Preserve the expensive work'])
  })
  it('does not count shell prompts as tests or rerun speech on OCR changes', async () => {
    const transport = vi.fn<CoachTransport>(async (_lane, _context, options) => { options.delta('Acknowledge the job before doing the expensive work.', 'fixture'); return { model: 'fixture', guidance: null } })
    const coach = new CoachController(transport)
    coach.start('practice', 'Investigate the timeout')
    coach.observe(screen())
    coach.question('How would you fix the timeout?')
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    const talkCalls = () => transport.mock.calls.filter(call => call[0] === 'talk').length
    expect(talkCalls()).toBe(1)
    for (let i = 0; i < 6; i++) coach.observe(screen(`return report${i};`, 0.92, `user${i}@host demo %`))
    expect(talkCalls()).toBe(1)
    expect(coach.getSnapshot().tests).toEqual([])
    expect(coach.getSnapshot().results[0].status).toBe('stale')
    await coach.run('talk', true)
    expect(talkCalls()).toBe(2)
    coach.observe(screen('return changed;', 1, 'Tests  4 passed'))
    expect(coach.getSnapshot().tests.at(-1)?.status).toBe('observed-pass')
    coach.dispose()
  })
  it('does not invalidate identical source for confidence jitter above the patch threshold', () => {
    const coach = new CoachController(async () => ({ model: 'fixture', guidance: null }))
    coach.start('practice', 'Read source'); coach.observe(screen())
    const version = coach.getSnapshot().evidenceVersion
    coach.observe(screen('return report;', 0.95))
    expect(coach.getSnapshot().evidenceVersion).toBe(version)
    coach.observe(screen('return report + 1;', 0.95))
    expect(coach.getSnapshot().codeVersion).toBe(1)
    coach.dispose()
  })
  it('lets a guide finish through added evidence but cancels it on a code edit', async () => {
    const clock = new VirtualClock(), signals: AbortSignal[] = []
    const transport: CoachTransport = async (lane, _packet, options) => {
      if (lane === 'talk') return { model: 'fixture', guidance: null }
      signals.push(options.signal)
      return new Promise(() => {})
    }
    const coach = new CoachController(transport, () => clock.now(), undefined, undefined, clock)
    coach.start('practice', 'Investigate'); coach.observe(screen()); coach.question('Explain the request path?')
    await clock.advance(900)
    expect(signals).toHaveLength(1)
    coach.observe({ ...screen(), visiblePaths: ['Service.java', 'Report.java'] })
    await clock.advance(900)
    expect(signals[0].aborted).toBe(false)
    expect(signals).toHaveLength(1)
    coach.observe(screen('return otherReport;'))
    expect(signals[0].aborted).toBe(true)
    await clock.advance(900)
    expect(signals).toHaveLength(2)
    coach.observe(screen('return otherReport;', 1, 'Tests  2 failed'))
    expect(signals[1].aborted).toBe(true)
    coach.dispose()
  })
  it('bounds the first guide while keeping deeper reasoning for edit review', () => {
    expect(coachGeneration('guide', 'claude-sonnet-5')).toMatchObject({ thinking: 'disabled', maxTokens: 2400, effort: 'low' })
    expect(coachGeneration('review', 'claude-sonnet-5')).toMatchObject({ thinking: 'adaptive', effort: 'medium' })
  })
  it('finishes speech through screen changes as an earlier-view answer, but cancels new instructions', async () => {
    let finish: (() => void) | undefined
    const requests: Parameters<CoachTransport>[2][] = []
    const transport: CoachTransport = async (lane, _packet, options) => {
      if (lane !== 'talk') return { model: 'fixture', guidance: null }
      requests.push(options)
      options.delta('Acknowledge the request first. ', 'fixture')
      await new Promise<void>(resolve => { finish = resolve })
      options.delta('Then run the report in a worker.', 'fixture')
      return { model: 'fixture', guidance: null }
    }
    const coach = new CoachController(transport)
    coach.start('practice', 'Investigate the timeout'); coach.observe(screen()); coach.question('How would you fix the timeout?')
    coach.observe({ ...screen('return changed;'), requirements: ['Report generation takes ten seconds.'] })
    expect(requests[0].signal.aborted).toBe(false)
    expect(coach.getSnapshot().results[0].status).toBe('running')
    finish!()
    await vi.waitFor(() => expect(coach.getSnapshot().results[0].status).toBe('stale'))
    const result = coach.getSnapshot().results[0]
    expect(result.text).toContain('Then run the report')
    expect(result.totalMs).not.toBeNull()
    expect(resultCurrent(result, coach.getSnapshot())).toBe(false)
    expect(sameSpokenTask(result, coach.getSnapshot())).toBe(true)
    expect(requests).toHaveLength(1)
    coach.question('What about retries?')
    expect(sameSpokenTask(result, coach.getSnapshot())).toBe(false)
    coach.task('Investigate the timeout', ['No API changes'])
    expect(requests[1].signal.aborted).toBe(true)
    expect(sameSpokenTask(result, coach.getSnapshot())).toBe(false)
    coach.dispose()
  })
})
