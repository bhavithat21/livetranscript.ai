import type { CoachState, CoachEvent, ContextPacket, EventPayload, Guidance, Lane, Observation, Origin, Permission } from './types'
import { buildContext, EvidenceIndex } from './context'
import { emptyCoach, normalizeQuestion, parseReplayEvent, reduceCoach, resultCurrent } from './state'
import { LIMITS, list, object, parseGuidance, redactSecrets, text } from './validation'

export type CoachTransport = (lane: Lane, packet: ContextPacket, options: { signal: AbortSignal; delta: (text: string, model: string) => void }) => Promise<{ model: string; guidance: Guidance | null }>
type Flight = { controller: AbortController; key: string; requestId: string }
export class CoachController {
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
  private retrySerial = 0
  readonly sessionId: string
  constructor(private transport: CoachTransport, private now: () => number = Date.now, private id: () => string = () => crypto.randomUUID(), sessionId?: string) {
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
  start(permission: Permission, objective: string) { this.emit({ type: 'session.start', permission, objective }) }
  task(objective: string, constraints: string[]) { this.emit({ type: 'task.update', objective, constraints }); this.cancelStale(); this.scheduleGuide() }
  speech(value: string, speaker: 'interviewer' | 'candidate' = 'interviewer') {
    if (this.state.status !== 'running') return
    const previous = this.state.evidenceVersion
    this.emit({ type: 'speech.final', speaker, text: value.slice(-4000) })
    if (this.state.evidenceVersion !== previous) { this.cancelStale(); this.scheduleGuide() }
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
      // Newly read files do not interrupt talk. Actual revisions/constraints do.
      if (!this.replay && !this.state.results.some(result => result.lane === 'talk' && resultCurrent(result, this.state) && ['running', 'complete'].includes(result.status))) void this.run('talk')
      this.scheduleGuide()
    }
  }
  private scheduleGuide() {
    if (this.timer) clearTimeout(this.timer)
    if (this.replay || this.disposed || this.state.status !== 'running' || !this.state.question) return
    this.timer = setTimeout(() => {
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
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const flight of this.flights.values()) flight.controller.abort()
    this.flights.clear()
  }
  async run(lane: Lane, explicitRetry = false) {
    if (this.disposed || this.state.status !== 'running' || !this.state.question || !this.state.permission) return
    if (this.flights.has(lane)) return
    if (lane !== 'talk' && !this.state.knownPaths.length) return
    let packet: ContextPacket
    try { packet = buildContext(this.state, lane === 'talk' ? 10_000 : LIMITS.context, this.index) }
    catch (error) { this.publish({ ...this.state, warning: error instanceof Error ? error.message : 'Context unavailable' }); return }
    const stable = lane === 'talk' ? `${packet.question.id}:${packet.codeVersion}:${packet.task.version}` : `${packet.question.id}:${packet.contextKey}`
    const key = `${lane}:${stable}${explicitRetry ? `:retry:${++this.retrySerial}` : ''}`
    if (this.attempted.has(key)) return
    const now = this.now()
    this.requestTimes = this.requestTimes.filter(time => now - time < 60_000)
    if (this.calls >= 120 || this.requestTimes.length >= 12) {
      this.publish({ ...this.state, warning: 'Automatic model budget reached. Pause, narrow the task, or wait for the per-minute budget to recover.' }); return
    }
    this.attempted.add(key); this.calls++; this.requestTimes.push(now)
    const requestId = this.id(), controller = new AbortController()
    this.flights.set(lane, { key, requestId, controller })
    this.emit({ type: 'result.start', lane, requestId, questionId: packet.question.id, evidenceVersion: packet.evidenceVersion, contextKey: packet.contextKey }, false)
    const timeout = setTimeout(() => controller.abort(), lane === 'talk' ? 9000 : 30_000)
    try {
      const result = await this.transport(lane, packet, { signal: controller.signal, delta: (value, model) => {
        if (!this.disposed && !controller.signal.aborted) this.emit({ type: 'result.delta', requestId, text: value, model }, false)
      } })
      if (controller.signal.aborted) throw new Error('Cancelled')
      if (this.disposed) return
      const guidance = result.guidance ? parseGuidance({ ...result.guidance, patches: result.guidance.patches.map(({ path, fileVersion, startLine, before, after, reason }) => ({ path, fileVersion, startLine, before, after, reason })) }, packet) : null
      this.emit({ type: 'result.complete', requestId, model: result.model, guidance }, false)
    } catch {
      if (!this.disposed) this.emit({ type: 'result.fail', requestId, cancelled: controller.signal.aborted,
        error: controller.signal.aborted ? 'Stopped or timed out. Retry explicitly when ready.' : 'The model request failed or returned unsupported evidence. Retry explicitly; no automatic retries are billed.' }, false)
    } finally {
      clearTimeout(timeout)
      if (this.flights.get(lane)?.requestId === requestId) this.flights.delete(lane)
    }
  }
  markTestStart(command: string) { if (this.state.status === 'running') this.emit({ type: 'test.start', command }) }
  feedback(resultId: string, verdict: 'pass' | 'needs-work', categories: string[], note: string) { this.emit({ type: 'feedback.add', resultId, verdict, categories, note }, false) }
  pause() { this.cancelAll(); if (this.state.status === 'running') this.emit({ type: 'session.pause' }) }
  resume() { if (this.state.status === 'paused') this.emit({ type: 'session.resume' }) }
  end() { this.cancelAll(); if (this.state.status !== 'ended') this.emit({ type: 'session.end' }) }
  dispose() { this.cancelAll(); this.disposed = true; this.listeners.clear(); this.index.clear() }
  exportReplay(): string {
    return JSON.stringify({ format: 'livetranscript-repo-replay-v1', sessionId: this.sessionId, truncated: this.journalTruncated, events: this.journal,
      evaluations: this.state.results.filter(item => item.status !== 'running').map(item => ({ ...item })), feedback: this.state.feedback,
      note: 'Contains selected source text and transcript fragments; no raw audio or screen images. Observed terminal output is not independent proof of test execution. Imported evaluations never become observed code.' },
    (_key, value) => typeof value === 'string' ? redactSecrets(value) : value, 2)
  }
  /** Loading is offline and cannot start a paid call. Analyze is explicit. */
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
    this.cancelAll(); this.replay = true; this.attempted.clear(); this.index.clear()
    this.journal = events.map(event => ({ ...event, sessionId: this.sessionId })); this.journalSize = JSON.stringify(this.journal).length
    this.publish({ ...state, status: 'paused', warning: 'Replay loaded offline. Saved model outputs are not treated as code evidence. Analyze explicitly to make new model calls.' })
  }
  analyzeReplay() { this.replay = false; this.resume(); void this.run('talk', true); void this.run('guide', true) }
  getMetrics() { return { modelRequests: this.calls, activeRequests: this.flights.size, journalEvents: this.journal.length, journalTruncated: this.journalTruncated } }
}
export const httpCoachTransport: CoachTransport = async (lane, context, options) => {
  const response = await fetch('/api/copilot/coach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane, context }), signal: options.signal })
  if (!response.ok || !response.body) throw new Error(`Coach unavailable (${response.status})`)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', received = 0, done = false, model = '', guidance: Guidance | null = null
  try {
    for (;;) {
      const chunk = await reader.read()
      received += chunk.value?.byteLength ?? 0
      if (received > 250_000) throw new Error('Response budget exceeded')
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
      if (chunk.done && buffer.trim()) { lines.push(buffer); buffer = '' }
      for (const line of lines) {
        if (!line.trim()) continue
        const event = object(JSON.parse(line))
        if (event.type === 'error') throw new Error('Model request failed')
        if (event.type === 'delta') options.delta(text(event.text, 8000), text(event.model, 180, true))
        else if (event.type === 'done') { model = text(event.model, 180, true); guidance = event.guidance === null ? null : event.guidance as Guidance; done = true }
        else if (event.type !== 'started') throw new Error('Unsupported stream event')
      }
      if (buffer.length > 120_000) throw new Error('Oversized stream event')
      if (chunk.done || done) break
    }
    if (!done) throw new Error('Incomplete response stream')
    return { model, guidance }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
}
