import { afterEach, describe, expect, it, vi } from 'vitest'
import { CoachController } from './controller'
import { buildContext, parseContext, nextInspection } from './context'
import { updateDiscussion } from './dialogue'
import { emptyCoach, navigationSeen } from './state'
import { ScreenObserver, httpCapture } from './screen'
import { ScreenReadError } from './screenErrors'
import { VirtualClock } from './simulation/clock'
import { ProactiveEngine, type QuestionInput } from '../copilot/proactiveEngine'
import { detectionInput } from '../interview/detectionTranscript'
import { questionCandidates } from '../copilot/questionDetection'
import type { ContextPacket, DialogueTurn } from './types'
import { ROUND_CASES, roundCase } from '../../evals/coach/roundCases'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
describe('production round continuity', () => {
  it.each(ROUND_CASES)('provides the original requirement and retained design to the real-provider case %s', id => {
    const packet = parseContext(roundCase(id).context)
    expect(packet.task.constraints.join(' ')).toContain('ten seconds')
    expect(packet.discussion?.find(turn => turn.sourceId === 'design')?.text).toContain('separate status request')
    expect(JSON.stringify(packet)).not.toContain('rubric')
  })
  it('carries the job acknowledgment design through later catch/retry questions without billing on dialogue', async () => {
    const packets: ContextPacket[] = [], clock = new VirtualClock()
    let id = 0
    const controller = new CoachController(async (_lane, packet) => { packets.push(packet); return { model: 'fixture', guidance: null } }, clock.now, () => `e${++id}`, 'round', clock)
    controller.start('practice', 'Keep the ten-second report calculation; prevent client timeout.')
    controller.dialogue({ sourceId: 'goal', at: 1, role: 'interviewer', text: 'We need to return an acknowledgment immediately while the report runs in the background.' })
    controller.dialogue({ sourceId: 'plan', at: 2, role: 'candidate', text: 'I would persist the job, return its job ID, and expose completion or failure through a separate status request.' })
    for (let at = 3; at < 40; at++) controller.dialogue({ sourceId: `chatter${at}`, at, role: 'candidate', text: 'That makes sense. The example is clear.' })
    expect(packets).toHaveLength(0)
    controller.question('What should happen inside the catch block?')
    expect(packets).toHaveLength(1)
    const packet = parseContext(packets[0])
    expect(packet.conversation?.some(turn => turn.sourceId === 'plan')).toBe(false)
    expect(packet.discussion?.map(turn => turn.sourceId)).toEqual(['goal', 'plan'])
    expect(packet.discussion?.[1].role).toBe('candidate')
    expect(packet.files).toEqual([])
    expect(packet.tests).toEqual([])
    expect(packet.task.implementation).toBe('allowed')
    const replay = controller.exportReplay()
    controller.end(); controller.loadReplay(replay)
    expect(controller.getSnapshot().discussion).toEqual(packet.discussion)
    expect(packets).toHaveLength(1)
    controller.dispose()
  })
  it('replaces corrected speech, removes unknown roles, and bounds persistent context', () => {
    const turn: DialogueTurn = { sourceId: 'goal', at: 1, role: 'interviewer', text: 'We need an immediate job acknowledgment.' }
    const initial = updateDiscussion([], turn)
    expect(updateDiscussion(initial, turn)).toBe(initial)
    expect(updateDiscussion(initial, { ...turn, text: 'Instead, we must keep the original RPC open.' })[0].text).toContain('original RPC')
    expect(updateDiscussion(initial, { ...turn, role: 'unknown' })).toEqual([])
    let discussion = initial
    for (let at = 2; at <= 40; at++) discussion = updateDiscussion(discussion, { ...turn, sourceId: `s${at}`, at, text: `We should consider option ${at}. ${'Tradeoff. '.repeat(80)}` })
    expect(discussion.length).toBeLessThanOrEqual(8)
    expect(discussion[0]).toEqual(turn)
    expect(discussion.at(-1)?.sourceId).toBe('s40')
    const state = emptyCoach('bounds')
    state.permission = 'practice'; state.discussion = discussion
    state.task.objective = 'Review the current proposal.'
    state.question = { id: 'q', original: 'What about errors?', text: 'What about errors?', at: 100 }
    expect(JSON.stringify(parseContext(buildContext(state, 10000))).length).toBeLessThan(10000)
  })
  it('includes capture failure in the next question without a health-triggered model call', () => {
    const packets: ContextPacket[] = []
    const controller = new CoachController(async (_lane, packet) => { packets.push(packet); return { model: 'fixture', guidance: null } })
    controller.start('practice', 'Review')
    controller.screenStatus({ status: 'error', capturedAt: 120 })
    expect(packets).toHaveLength(0)
    controller.question('What changed in the callback?')
    expect(parseContext(packets[0]).screenFreshness).toEqual({ status: 'error', capturedAt: 120 })
    controller.dispose()
  })
  it('replaces an in-flight answer when the interviewer corrects the outcome without asking another question', () => {
    const packets: ContextPacket[] = [], signals: AbortSignal[] = []
    const controller = new CoachController(async (_lane, packet, options) => { packets.push(packet); signals.push(options.signal); return new Promise(() => {}) })
    controller.start('practice', 'Discuss reports')
    controller.question('How should we respond?')
    controller.speech('We need to return an acknowledgment immediately.')
    expect(signals[0].aborted).toBe(true)
    expect(packets[1].task.constraints.join(' ')).toContain('acknowledgment immediately')
    controller.speech('We need to return an acknowledgment immediately.')
    expect(packets).toHaveLength(2)
    controller.dispose()
  })
  it('waits through ongoing interviewer speech and includes the requested outcome, then dispatches promptly at the endpoint', async () => {
    const clock = new VirtualClock(), asked: string[] = []
    const rows = [{ id: 1, capturedAt: 1, speaker: 1, isFinal: true, endOfTurn: false, text: 'Can you create a separate thread?' }]
    let input: QuestionInput = detectionInput(rows, [], 1)
    const engine = new ProactiveEngine(() => input, q => { asked.push(q) }, {}, clock)
    engine.start(); await clock.advance(1200)
    expect(asked).toEqual([])
    input = detectionInput([...rows, { id: 2, capturedAt: 1200, speaker: 1, isFinal: false, endOfTurn: false, text: 'and return something' }], [], 1)
    await clock.advance(1500)
    expect(asked).toEqual([])
    input = detectionInput([...rows, { id: 2, capturedAt: 1200, speaker: 1, isFinal: true, endOfTurn: true, text: 'and return something immediately while the report runs?' }], [], 1)
    await clock.advance(600)
    expect(asked).toEqual(['Can you create a separate thread and return something immediately while the report runs?'])
    await clock.advance(3000)
    expect(asked).toHaveLength(1)
    engine.stop()
  })
  it('keeps an imperative outcome attached to the ask and recovers a missing endpoint', async () => {
    const question = 'Can you create a separate thread? Return something while the report runs.'
    expect(questionCandidates(question).at(-1)?.question).toBe(question)
    const clock = new VirtualClock(), asked: string[] = []
    const engine = new ProactiveEngine(() => ({ text: question, endOfTurn: false }), q => { asked.push(q) }, {}, clock)
    engine.start(); await clock.advance(2400); expect(asked).toEqual([])
    await clock.advance(600); expect(asked).toEqual([question]); engine.stop()
  })
  it('skips a unique tree display-root alias without merging code or resolving colliding roots', () => {
    const state = emptyCoach('paths'), path = 'src/main/java/ReportService.java', alias = `DEMO/${path}`
    state.knownPaths = [alias, path]
    const file = { path, language: 'java', startLine: 1, lines: ['class Service {}'], confidence: 1, endOfFile: true }
    state.files = [{ ...file, version: 1, retired: [], contentKey: 'v1', lastSeen: 1, fragments: [{ ...file, sources: ['screen'] }] }]
    const navigation = { path: alias, startLine: 1, endLine: 1, symbol: '', reason: 'Inspect', status: 'pending' as const, requestedAfter: 1 }
    state.navigation = navigation
    const observation = { files: [file], visiblePaths: state.knownPaths, terminal: '', requirements: [] }
    expect(nextInspection(state)?.path).toBe(path)
    // A navigation hint must never turn the alternate path into read evidence.
    expect(navigationSeen(navigation, observation)).toBe(false)
    state.knownPaths.push(`OTHER/${path}`)
    expect(nextInspection(state)?.path).toBe(alias)
    expect(navigationSeen(navigation, observation)).toBe(false)
    expect(state.files).toHaveLength(1)
  })
})

describe('screen recovery', () => {
  it('resumes only the same previously watched source, preserving explicit pause and stop', async () => {
    const source = { signal: async () => ({ width: 1, height: 1, pixels: new Uint8Array([0]), fingerprint: 'x' }), image: async () => 'data:image/png;base64,AA==', stop: vi.fn() }
    const screen = new ScreenObserver(() => {}, async () => ({ files: [], visiblePaths: [], requirements: [], terminal: '' }))
    await screen.attach(source, 'browser')
    screen.watch(true); screen.pause()
    expect(screen.getSnapshot().watching).toBe(false)
    screen.resume(); expect(screen.getSnapshot().watching).toBe(true)
    screen.watch(false); screen.pause(); screen.resume()
    expect(screen.getSnapshot().watching).toBe(false)
    screen.watch(true); screen.pause(); await screen.stop(); screen.resume()
    expect(screen.getSnapshot().sharing).toBe(false)
    expect(screen.getSnapshot().watching).toBe(false)
    expect(source.stop).toHaveBeenCalledOnce(); screen.dispose()
  })
  it('preserves safe capture categories and never resumes an error-paused source', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ code: 'configuration', error: 'PRIVATE PROVIDER CONTENT' }, { status: 503 })))
    await expect(httpCapture('data:image/png;base64,AA==', new AbortController().signal)).rejects.toEqual(new ScreenReadError('configuration'))
    const observer = new ScreenObserver(() => {}, async () => { throw new ScreenReadError('timeout') })
    await observer.attach({ signal: async () => null, image: async () => null, stop: () => {} }, 'browser')
    await observer.capture('data:image/png;base64,AA==')
    expect(observer.getSnapshot().error).toContain('timed out')
    observer.pause(); observer.resume()
    expect(observer.getSnapshot().watching).toBe(false)
    observer.dispose()
  })
})
