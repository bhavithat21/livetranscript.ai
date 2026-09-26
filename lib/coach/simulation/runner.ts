import { CoachController, type CoachTransport } from '../controller'
import { ProactiveEngine } from '../../copilot/proactiveEngine'
import { detectionTranscript } from '../../interview/detectionTranscript'
import type { CapturedSegment } from '../../interview/useInterviewRecorder'
import { parseGuidance } from '../validation'
import type { ContextPacket, Guidance, Lane } from '../types'
import { VirtualClock } from './clock'
import { AFTER, BEFORE, PATH } from './scenarios'
import type { Scenario, SimEvent, SimReport, SimRequest, SimState } from './types'

function random(seed: number) { let x = seed >>> 0; return () => { x = (Math.imul(1664525, x) + 1013904223) >>> 0; return x / 4294967296 } }
/** Scripted response derived ONLY from supplied evidence, never scenario expectations.
 * Used to test orchestration contracts, not measure reasoning capability. */
function fixtureGuidance(context: ContextPacket): Guidance {
  const file = context.files.find(f => f.path === PATH)
  const patchable = context.task.implementation === 'allowed' && file?.fragments.some(f => f.lines.includes(BEFORE))
  return parseGuidance({ summary: patchable ? 'Synthetic fixture: require both sides of the allowed transition.' : 'Synthetic fixture: inspect the missing evidence before making further changes.',
    look: context.knownPaths.includes('test/transition.test.ts') ? [{ path: 'test/transition.test.ts', startLine: null, endLine: null, symbol: '', reason: 'Inspect the targeted transition assertions.' }] : [],
    patches: patchable ? [{ path: PATH, fileVersion: file!.fileVersion, startLine: 2, before: BEFORE, after: AFTER, reason: 'The observed requirement needs both conditions.' }] : [],
    findings: [], hypotheses: [], verify: [{ command: 'npm test', scope: 'targeted transition tests', reason: 'Test the allowed case and both invalid directions.' }] }, context)
}

export class RealtimeSimulator {
  readonly clock = new VirtualClock()
  readonly controller: CoachController
  private engine: ProactiveEngine
  private startAt = this.clock.now()
  private call: CapturedSegment[] = []
  private mic: CapturedSegment[] = []
  private interviewer = 1
  private requests: SimRequest[] = []
  private errors: string[] = []
  private consumed = 0
  private listeners = new Set<() => void>()
  private disposed = false
  private snapshot!: SimState
  private serial = 0
  private utteranceIds = new Map<string, number>()
  constructor(readonly scenario: Scenario, readonly seed = 1) {
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Seed must be an unsigned 32-bit integer')
    const rand = random(seed), occurrences = new Map<Lane, number>()
    const transport: CoachTransport = (lane, context, { signal, delta }) => {
      const occurrence = (occurrences.get(lane) ?? 0) + 1; occurrences.set(lane, occurrence)
      const fault = scenario.faults?.find(f => f.lane === lane && f.occurrence === occurrence)
      const request: SimRequest = { at: this.time(), lane, question: context.question.text, status: 'pending', context }
      this.requests.push(request)
      return new Promise((resolve, reject) => {
        const model = `simulated-${lane}-NOT-a-model`
        const finish = () => {
          signal.removeEventListener('abort', abort)
          request.completedAt = this.time()
          if (!signal.aborted) request.status = fault?.behavior === 'fail' ? 'failed' : 'complete'
          if (fault?.behavior === 'fail') { reject(new Error('Injected provider failure')); return }
          try {
            if (lane === 'talk') delta(`Synthetic response to: ${context.question.text} I would inspect the current condition and verify the relevant tests.`, model)
            if (fault?.behavior === 'unsupported-patch') {
              const guidance = { ...fixtureGuidance(context), patches: [{ id: 'fake', path: 'never-observed.ts', fileVersion: 1, startLine: 1, before: 'x', after: 'y', reason: 'Unseen target', evidence: [] }] }
              resolve({ model, guidance })
            } else resolve({ model, guidance: lane === 'talk' ? null : fixtureGuidance(context) })
          } catch (error) { reject(error) }
        }
        const delay = fault?.delayMs ?? Math.round((lane === 'talk' ? 160 : 320) + rand() * 80)
        const timer = fault?.behavior === 'hang' ? null : this.clock.setTimeout(finish, delay)
        const abort = () => {
          request.status = 'aborted'; request.completedAt = this.time()
          if (!fault?.ignoreAbort) { if (timer !== null) this.clock.clearTimeout(timer); reject(new Error('Injected request cancelled')) }
        }
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
    this.controller = new CoachController(transport, this.clock.now, () => `sim-${seed}-${++this.serial}`, `sim-${scenario.id}-${seed}`, this.clock)
    this.controller.start('practice', scenario.objective)
    this.engine = new ProactiveEngine(() => detectionTranscript(this.call, this.mic, this.interviewer), q => this.controller.question(q), { latestWins: true, onError: e => { if (e) this.errors.push(e) } }, this.clock)
    this.engine.start(); this.publish()
  }
  private time() { return this.clock.now() - this.startAt }
  private publish() { this.snapshot = { time: this.time(), events: this.consumed, state: this.controller.getSnapshot(), requests: [...this.requests], transportErrors: [...this.errors] }; this.listeners.forEach(fn => fn()) }
  getSnapshot = () => this.snapshot
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private apply(event: SimEvent) {
    const action = event.action
    try {
      if (action.kind === 'speech') {
        const rows = action.channel === 'call' ? this.call : this.mic
        const utteranceKey = `${action.channel}:${action.id}`
        if (!this.utteranceIds.has(utteranceKey)) this.utteranceIds.set(utteranceKey, this.utteranceIds.size + 1)
        const segmentId = this.utteranceIds.get(utteranceKey)!
        const previous = rows.find(r => r.id === segmentId)
        const row: CapturedSegment = { id: segmentId, text: action.text, speaker: action.speaker, isFinal: action.final !== false, capturedAt: previous?.capturedAt ?? this.clock.now(), startMs: event.at, endMs: event.at + 10 }
        const index = rows.findIndex(r => r.id === segmentId)
        if (index >= 0) rows[index] = row; else rows.push(row)
        if (row.isFinal) {
          const role = action.channel === 'mic' || (action.speaker !== null && action.speaker !== this.interviewer) ? 'candidate' : action.speaker === this.interviewer ? 'interviewer' : 'unknown'
          this.controller.dialogue({ sourceId: `${action.channel}:${row.id}`, at: row.capturedAt, role, text: row.text })
          // dialogue() is the shared settled requirement/intent ingestion path.
        }
      } else if (action.kind === 'screen') this.controller.observe(action.observation, action.importOnly ? 'file-import' : 'screen', action.capturedAt === undefined ? undefined : this.startAt + action.capturedAt)
      else if (action.kind === 'test') this.controller.markTestStart(action.command)
      else if (action.kind === 'pause') { this.engine.stop(); this.controller.pause() }
      else if (action.kind === 'resume') { this.controller.resume(); this.engine.start() }
      else if (action.kind === 'end') { this.engine.stop(); this.controller.end() }
      else if (action.kind === 'retry') void this.controller.run(action.lane, true)
      else if (action.kind === 'interviewer') this.interviewer = action.speaker
    } catch (error) { this.errors.push(error instanceof Error ? error.message : 'Scenario event failed') }
  }
  async advance(ms: number) {
    if (this.disposed) return
    if (!Number.isFinite(ms) || ms < 0 || ms > 180_000) throw new Error('Invalid simulation advance')
    const target = Math.min(this.scenario.duration, this.time() + ms)
    while (this.consumed < this.scenario.events.length && this.scenario.events[this.consumed].at <= target) {
      const event = this.scenario.events[this.consumed]
      await this.clock.advance(Math.max(0, event.at - this.time()))
      if (this.disposed) return
      this.apply(event); this.consumed++
    }
    await this.clock.advance(Math.max(0, target - this.time()))
    if (!this.disposed) this.publish()
  }
  async finish() { await this.advance(this.scenario.duration - this.time()); return this.report() }
  report(): SimReport {
    const checks = this.scenario.check(this.snapshot)
    const complete = this.time() >= this.scenario.duration
    checks.unshift({ id: 'finished', label: 'Scenario ran to its final checkpoint', expected: 'true', actual: String(complete), passed: complete })
    const active = this.controller.getMetrics().activeRequests
    checks.push({ id: 'no-stuck-flight', label: 'No model lane remains stuck after the drain window', expected: '0', actual: String(active), passed: active === 0 })
    return { format: 'livetranscript-simulator-v1', scenarioId: this.scenario.id, seed: this.seed, kind: 'synthetic-runtime-test', realAudio: false, realVision: false, providerInference: false,
      simulatedMs: this.time(), events: this.consumed, requests: this.requests.length, activeRequests: active, checks, passed: checks.every(c => c.passed), failures: checks.filter(c => !c.passed).map(c => `${c.id}: expected ${c.expected}; got ${c.actual}`) }
  }
  dispose() { this.disposed = true; this.engine.stop(); this.controller.dispose(); this.clock.clear(); this.listeners.clear() }
}
