import { abortable, systemClock, type Clock } from './clock'
import type { CoachState, CoachEvent, ContextPacket, EventPayload, Guidance, Lane, Observation, Origin, Permission, DialogueTurn } from './types'
import { buildContext, EvidenceIndex } from './context'
import { emptyCoach, normalizeQuestion, parseReplayEvent, reduceCoach, resultCurrent } from './state'
import { lessonIds, type LessonId } from './learning/policy'
import { LIMITS, list, object, parseGuidance, redactSecrets, text } from './validation'
import { diagnosticSpan, recordDiagnostic } from './diagnostics'
import type { RetryNotice } from './retry'

export type ReplayReference = { id: string; lane: string; model: string; text: string; summary: string; note: string; verdict: string }
export type CoachTransport = (lane: Lane, packet: ContextPacket, options: { signal: AbortSignal; instructions?: string; lessons?: LessonId[]; diagnosticHeaders?: Record<string, string>; onRetry?: (notice: RetryNotice) => void; beforeRetry?: () => boolean; delta: (text: string, model: string) => void }) => Promise<{ model: string; guidance: Guidance | null }>
type Flight = { controller: AbortController; key: string; requestId: string }
export class CoachController {
  private lessons: LessonId[] = []
  private resumeLanes: Lane[] = []
  private resumeGuide = false
  private state: CoachState
  private listeners = new Set<() => void>()
  private flights = new Map<Lane, Flight>()
  private attempted = new Set<string>()
  private journal: CoachEvent[] = []
  private journalSize = 0
  private journalTruncated = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private requestTimes: number[] = []
  private calls = 0
  private index = new EvidenceIndex()
  private disposed = false
  private replay = false
  private replayEvents: CoachEvent[] = []
  private replayPosition = 0
  private replayReferences: ReplayReference[] = []
  private retrySerial = 0
  readonly sessionId: string
  constructor(private transport: CoachTransport, private now: () => number = Date.now, private id: () => string = () => crypto.randomUUID(), sessionId?: string, private clock: Clock = systemClock) {
    this.sessionId = sessionId ?? this.id()
    this.state = emptyCoach(this.sessionId)
  }
  getSnapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish(state: CoachState) { this.state = state; this.listeners.forEach(listener => listener()) }
  private emit(payload: EventPayload, record = true): CoachEvent {
    const event: CoachEvent = { ...payload, id: this.id(), at: this.now(), sessionId: this.sessionId }
    const next = reduceCoach(this.state, event)
    if (next !== this.state) {
      if (record && !payload.type.startsWith('result.') && payload.type !== 'feedback.add') {
        const size = JSON.stringify(event).length
        if (!this.journalTruncated && this.journal.length < LIMITS.events && this.journalSize + size <= LIMITS.replayBytes) { this.journal.push(event); this.journalSize += size }
        else this.journalTruncated = true
      }
      this.publish(next)
    }
    return event
  }
  configureLessons(ids: LessonId[]) {
    if (this.state.status === 'running') return
    const next = lessonIds(ids)
    if (JSON.stringify(next) === JSON.stringify(this.lessons)) return
    this.lessons = next; this.attempted.clear()
  }
  start(permission: Permission, objective: string) { if (this.disposed) return; this.emit({ type: 'session.start', permission, objective }) }
  task(objective: string, constraints: string[]) {
    if (this.state.status !== 'running' || this.disposed) return
    this.emit({ type: 'task.update', objective, constraints }); this.cancelStale()
    if (!this.replay) void this.run('talk')
    this.scheduleGuide()
  }
  speech(value: string, speaker: 'interviewer' | 'candidate' = 'interviewer') {
    if (this.disposed || this.state.status !== 'running') return
    const previous = this.state.evidenceVersion
    this.emit({ type: 'speech.final', speaker, text: value.slice(-4000) })
    if (this.state.evidenceVersion !== previous) {
      this.cancelStale()
      if (!this.replay) void this.run('talk')
      this.scheduleGuide()
    }
  }
  dialogue(turn: DialogueTurn) {
    if (this.disposed || this.state.status !== 'running') return
    this.emit({ type: 'dialogue.update', turn })
  }
  question(original: string) {
    if (this.state.status !== 'running' || this.disposed) return
    const previous = this.state.question?.id
    this.emit({ type: 'question.new', original: original.slice(0, 4000), text: normalizeQuestion(original) })
    if (this.state.question?.id === previous) return
    this.cancelAll()
    if (!this.replay) { void this.run('talk'); this.scheduleGuide() }
  }
  observe(observation: Observation, origin: Origin = 'screen', capturedAt?: number) {
    if (this.disposed || this.state.status !== 'running') return
    const previous = this.state.evidenceVersion
    this.emit({ type: 'screen.observed', observation, origin, ...(capturedAt === undefined ? {} : { capturedAt }) })
    if (this.state.evidenceVersion !== previous) {
      this.cancelStale()
      if (!this.replay && !this.state.results.some(result => result.lane === 'talk' && resultCurrent(result, this.state) && ['running', 'complete'].includes(result.status))) void this.run('talk')
      this.scheduleGuide()
    }
  }
  observeScreen(observation: Observation, capturedAt?: number) {
    this.observe(observation, 'screen', capturedAt)
    if (!this.replay && !this.state.question && observation.requirements.some(value => value.trim())) this.question(observation.requirements.join('\n').slice(0, 2000))
  }
  private scheduleGuide() {
    if (this.timer) this.clock.clearTimeout(this.timer)
    if (this.replay || this.disposed || this.state.status !== 'running' || !this.state.question) return
    this.timer = this.clock.setTimeout(() => {
      this.timer = null
      if (this.state.patches.length && this.state.patchReviews.some(review => ['differs', 'matches-proposal', 'reverted'].includes(review.status))) void this.run('review')
      else void this.run('guide')
    }, 650)
  }
  private cancelStale() {
    for (const [lane, flight] of this.flights) {
      const record = this.state.results.find(item => item.id === flight.requestId)
      if (!record || !resultCurrent(record, this.state)) { flight.controller.abort(); this.flights.delete(lane) }
    }
  }
  private cancelAll() {
    if (this.timer) this.clock.clearTimeout(this.timer)
    this.timer = null
    for (const flight of this.flights.values()) flight.controller.abort()
    this.flights.clear()
  }
  async run(lane: Lane, explicitRetry = false) {
    if (this.disposed || this.state.status !== 'running' || !this.state.question || !this.state.permission) return
    if (this.flights.has(lane)) return
    let packet: ContextPacket
    try { packet = buildContext(this.state, lane === 'talk' ? 10_000 : LIMITS.context, this.index) }
    catch (error) { recordDiagnostic(lane, 'error', { code: 'invalid_shape' }); this.publish({ ...this.state, warning: error instanceof Error ? error.message : 'Context unavailable' }); return }
    const stable = `${packet.question.id}:${packet.evidenceVersion}:${packet.codeVersion}:${packet.task.version}:${packet.contextKey}`
    const key = `${lane}:${stable}${explicitRetry ? `:retry:${++this.retrySerial}` : ''}`
    if (this.attempted.has(key)) return
    const now = this.now()
    this.requestTimes = this.requestTimes.filter(time => now - time < 60_000)
    if (this.calls >= 120 || this.requestTimes.length >= 12) {
      recordDiagnostic(lane, 'paused', { code: 'rate_limited', count: this.calls })
      this.publish({ ...this.state, warning: 'Automatic model budget reached. Pause, narrow the task, or wait for the per-minute budget to recover.' }); return
    }
    this.attempted.add(key); this.calls++; this.requestTimes.push(now)
    const requestId = this.id(), controller = new AbortController()
    const trace = diagnosticSpan(lane)
    let timedOut = false, firstToken = false
    this.flights.set(lane, { key, requestId, controller })
    this.emit({ type: 'result.start', lane, requestId, questionId: packet.question.id, evidenceVersion: packet.evidenceVersion, contextKey: packet.contextKey }, false)
    const timeout = this.clock.setTimeout(() => { timedOut = true; controller.abort() }, lane === 'talk' ? 9000 : 30_000)
    try {
      const result = await abortable(this.transport(lane, packet, {
        signal: controller.signal, lessons: [...this.lessons], diagnosticHeaders: trace.headers(),
        onRetry: notice => trace.event('retry', { attempts: notice.attempt, delayMs: notice.delayMs, httpStatus: notice.status }),
        beforeRetry: () => {
          if (this.disposed || this.state.status !== 'running' || controller.signal.aborted) return false
          const at = this.now(); this.requestTimes = this.requestTimes.filter(time => at - time < 60_000)
          if (this.calls >= 120 || this.requestTimes.length >= 12) { trace.event('paused', { code: 'rate_limited', count: this.calls }); return false }
          this.calls++; this.requestTimes.push(at); return true
        },
        delta: (value, model) => {
          if (!this.disposed && !controller.signal.aborted) {
            if (!firstToken && value.trim()) { firstToken = true; trace.event('first_token', { model, firstTokenMs: this.now() - now }) }
            this.emit({ type: 'result.delta', requestId, text: value, model }, false)
          }
        },
      }), controller.signal)
      if (controller.signal.aborted) throw new Error('Cancelled')
      if (this.disposed) { trace.end('cancelled'); return }
      const guidance = result.guidance ? parseGuidance({ ...result.guidance, patches: result.guidance.patches.map(({ path, fileVersion, startLine, before, after, reason }) => ({ path, fileVersion, startLine, before, after, reason })) }, packet) : null
      this.emit({ type: 'result.complete', requestId, model: result.model, guidance }, false)
      trace.end('success', { model: result.model })
    } catch (error) {
      if (timedOut) trace.end('error', { code: 'timeout' })
      else if (controller.signal.aborted) trace.end('cancelled', { code: 'cancelled' })
      else trace.failure(error, error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined)
      if (!this.disposed) this.emit({ type: 'result.fail', requestId, cancelled: controller.signal.aborted,
        error: controller.signal.aborted ? 'Stopped or timed out. Retry explicitly when ready.' : 'Assistance could not complete after any eligible automatic retries. Check the error in Diagnostics, then retry explicitly. Partial answers are not automatically replayed.' }, false)
    } finally {
      this.clock.clearTimeout(timeout)
      if (this.flights.get(lane)?.requestId === requestId) this.flights.delete(lane)
    }
  }
  markTestStart(command: string) { if (!this.disposed && this.state.status === 'running') this.emit({ type: 'test.start', command }) }
  feedback(resultId: string, verdict: 'pass' | 'needs-work', categories: string[], note: string) {
    const lane = this.state.results.find(result => result.id === resultId)?.lane ?? 'guide'
    recordDiagnostic(lane, 'feedback', { verdict, category: categories[0] })
    this.emit({ type: 'feedback.add', resultId, verdict, categories, note }, false)
  }
  pause() {
    if (this.state.status !== 'running') return
    this.resumeLanes = [...this.flights.keys()]; this.resumeGuide = this.timer !== null
    this.cancelAll(); this.emit({ type: 'session.pause' })
  }
  resume() {
    if (this.disposed || this.state.status !== 'paused') return
    const lanes = this.resumeLanes, guide = this.resumeGuide
    this.resumeLanes = []; this.resumeGuide = false
    this.emit({ type: 'session.resume' })
    if (!this.replay) { for (const lane of lanes) void this.run(lane, true); if (guide) this.scheduleGuide() }
  }
  end() { this.cancelAll(); if (this.state.status !== 'ended') this.emit({ type: 'session.end' }) }
  dispose() { this.cancelAll(); this.disposed = true; this.listeners.clear(); this.index.clear() }
  exportReplay(): string {
    return JSON.stringify({ format: 'livetranscript-repo-replay-v1', sessionId: this.sessionId, truncated: this.journalTruncated, events: this.journal,
      evaluations: [...this.replayReferences.map(item => ({ ...item, referenceOnly: true })), ...this.state.results.filter(item => item.status !== 'running').map(item => ({ ...item }))], feedback: this.state.feedback,
      note: 'Contains selected source text and transcript fragments; no raw audio or screen images. Observed terminal output is not independent proof of test execution. Imported evaluations never become observed code.' },
    (_key, value) => typeof value === 'string' ? redactSecrets(value.slice(0)) : value, 2)
  }
  loadReplay(raw: string) {
    if (this.state.status === 'running') throw new Error('Pause or end before replacing this session with a replay')
    text(raw, LIMITS.replayBytes)
    const root = object(JSON.parse(raw), ['format', 'sessionId', 'truncated', 'events', 'evaluations', 'feedback', 'note'])
    if (root.format !== 'livetranscript-repo-replay-v1' || root.truncated !== false) throw new Error('Replay must be complete and use schema v1')
    const sourceSession = text(root.sessionId, 100, true), events = list(root.events, LIMITS.events).map(parseReplayEvent)
    let state = emptyCoach(this.sessionId), time = -1
    const seen = new Set<string>()
    for (const original of events) {
      if (original.sessionId !== sourceSession || original.at < time || seen.has(original.id)) throw new Error('Invalid replay order, identity or duplicate event')
      time = original.at; seen.add(original.id)
      let event: CoachEvent = { ...original, sessionId: this.sessionId }
      if (event.type === 'session.start') event = { ...event, permission: 'practice' }
      state = reduceCoach(state, event)
    }
    if (!events.length || events[0].type !== 'session.start') throw new Error('Replay must begin with an explicit practice/session start')
    const annotations = Array.isArray(root.evaluations) ? root.evaluations.slice(-80) : []
    const reviews = Array.isArray(root.feedback) ? root.feedback.slice(-100) : []
    const references: ReplayReference[] = []
    for (const value of annotations) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const item = value as Record<string, unknown>
      if (typeof item.id !== 'string' || !['talk', 'guide', 'review'].includes(String(item.lane))) continue
      const review = reviews.findLast(value => value && typeof value === 'object' && (value as Record<string, unknown>).resultId === item.id) as Record<string, unknown> | undefined
      const guidance = item.guidance && typeof item.guidance === 'object' ? item.guidance as Record<string, unknown> : null
      const plain = (value: unknown, max: number) => typeof value === 'string' ? redactSecrets(value.slice(0, max)) : ''
      references.push({ id: plain(item.id, 100), lane: String(item.lane), model: plain(item.model, 180), text: plain(item.text, LIMITS.output), summary: plain(guidance?.summary ?? item.summary, 4000), note: plain(review?.note ?? item.note, 2000), verdict: plain(review?.verdict ?? item.verdict, 30) })
    }
    this.replayEvents = events.map(event => ({ ...event, sessionId: this.sessionId, ...(event.type === 'session.start' ? { permission: 'practice' as const } : {}) }))
    this.replayReferences = references
    this.seekReplay(events.length)
  }
  seekReplay(position: number) {
    if (!Number.isInteger(position) || position < 1 || position > this.replayEvents.length) throw new Error('Invalid replay checkpoint')
    this.cancelAll(); this.replay = true; this.attempted.clear(); this.index.clear()
    let state = emptyCoach(this.sessionId)
    const events = this.replayEvents.slice(0, position)
    for (const event of events) state = reduceCoach(state, event)
    this.replayPosition = position; this.journal = events; this.journalSize = JSON.stringify(events).length; this.journalTruncated = false
    this.publish({ ...state, status: 'paused', warning: 'Replay checkpoint loaded offline. Saved model answers and review notes are reference only. Analyze explicitly to make new model calls.' })
  }
  getReplayInfo() { return { position: this.replayPosition, total: this.replayEvents.length, event: this.replayEvents[this.replayPosition - 1]?.type ?? '', references: this.replayReferences } }
  analyzeReplay() { this.replay = false; this.resume(); void this.run('talk', true); void this.run('guide', true) }
  getMetrics() { return { modelRequests: this.calls, activeRequests: this.flights.size, journalEvents: this.journal.length, journalTruncated: this.journalTruncated } }
}
export { httpCoachTransport } from './transport'
