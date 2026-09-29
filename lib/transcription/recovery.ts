import type { TranscriptEvent, TranscriptionConfig, TranscriptionProvider, TranscriptionStatus } from './types'

export type ConnectedTranscription = { provider: TranscriptionProvider; name: string }
export type RecoveryEvent = { state: 'reconnecting' | 'reconnected' | 'gap' | 'failed'; attempt: number; generation: number; droppedMs?: number }
export type Reconnector = (config: TranscriptionConfig, preferred: string) => Promise<ConnectedTranscription>
const MAX_BUFFER_MS = 2000
const MAX_BUFFER_BYTES = 512_000
const MAX_EPISODE_MS = 20_000
const MAX_ATTEMPTS = 3
const MAX_SESSION_ATTEMPTS = 6

/** An outage can lose provider-accepted but unfinalized audio. Never replay that
 * audio or claim exactly-once transcription. Only NOT-YET-SENT PCM is buffered. */
export function retryableTranscriptionFailure(error: unknown): boolean {
  const e = (error ?? {}) as { status?: number; retryable?: boolean; name?: string; message?: string; error?: string }
  if (e.retryable === false || e.name === 'AbortError') return false
  if (typeof e.status === 'number') return [408, 429, 500, 502, 503, 504, 529].includes(e.status)
  const message = String(e.message ?? e.error ?? error).slice(0, 1000)
  if (/permission|notallowed|denied|unauthori|forbidden|invalid (?:key|token)|quota|credit|billing/i.test(message)) return false
  return e.retryable === true || /network|connection|websocket|\bWS\b|timeout|timed out|failed to fetch/i.test(message)
}

function bounded<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void operation.catch(() => {}); return Promise.reject(signal.reason) }
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}

type Frame = { data: ArrayBuffer; at: number; duration: number }
type Timeline = { providerMs: number; sessionMs: number }
type Connection = ConnectedTranscription & { generation: number; sentMs: number; timeline: Timeline[]; speakerBase: number }

/** Keeps physical capture alive while only the failed ASR connection is replaced.
 * Readiness, recovery and terminal failures are separate signals. No OS restarts. */
export class RecoveringTranscription implements TranscriptionProvider {
  private connection: Connection | null
  private closing = false
  private stopped = false
  private recovering = false
  private generation = 0
  private attempts = 0
  private cursorMs = 0
  private highestSpeaker = -1
  private pending: Frame[] = []
  private pendingBytes = 0
  private droppedMs = 0
  private pumpTimer: ReturnType<typeof setTimeout> | null = null
  private episode: AbortController | null = null
  private stopPromise: Promise<void> | null = null
  private partial: (event: TranscriptEvent) => void = () => {}
  private final: (event: TranscriptEvent) => void = () => {}
  private status: (value: TranscriptionStatus) => void = () => {}
  private readonly identity = crypto.randomUUID()
  private readonly onAbort = () => { this.hardStop() }
  constructor(initial: ConnectedTranscription, private config: TranscriptionConfig, private reconnect: Reconnector, private progress: (event: RecoveryEvent) => void = () => {}) {
    this.connection = this.bind(initial)
    config.signal?.addEventListener('abort', this.onAbort, { once: true })
    if (config.signal?.aborted) this.hardStop()
  }
  /** Explicit mock-only control calls the same production recovery path. */
  testConnectionLoss(): boolean {
    if (!this.connection || this.recovering || this.closing || this.stopped) return false
    this.drop({ error: 'Connection lost during an explicit mock', retryable: true }); return true
  }
  get isRecovering() { return this.recovering && !this.stopped && !this.closing }
  async connect(): Promise<void> { throw new Error('Recovery wraps an already connected provider') }
  onPartial(callback: (event: TranscriptEvent) => void) { this.partial = callback }
  onFinal(callback: (event: TranscriptEvent) => void) { this.final = callback }
  onStatus(callback: (status: TranscriptionStatus) => void) { this.status = callback }
  async updateKeyterms(terms: string[]) { this.config = { ...this.config, keyterms: [...terms] }; await this.connection?.provider.updateKeyterms(terms) }
  private notify(event: RecoveryEvent) { try { this.progress(event) } catch { /* telemetry/UI cannot break recovery */ } }
  private bind(value: ConnectedTranscription): Connection {
    const connection: Connection = { ...value, generation: this.generation, sentMs: 0, timeline: [], speakerBase: this.highestSpeaker + 1 }
    const ingest = (event: TranscriptEvent) => {
      if (this.stopped || this.connection !== connection || (this.closing && !event.isFinal)) return
      const time = (ms: number) => {
        const anchor = connection.timeline.findLast(entry => entry.providerMs <= ms) ?? connection.timeline[0]
        return anchor ? Math.max(0, anchor.sessionMs + ms - anchor.providerMs) : ms
      }
      const speaker = (value: number | null) => {
        if (value === null || !Number.isInteger(value) || value < 0 || value > 100) return null
        const id = connection.speakerBase + value; this.highestSpeaker = Math.max(this.highestSpeaker, id); return id
      }
      const mapped: TranscriptEvent = { ...event, utteranceId: `${this.identity}:${connection.generation}:${event.utteranceId ?? event.startMs}`,
        startMs: time(event.startMs), endMs: time(event.endMs), speaker: speaker(event.speaker),
        ...(event.parts ? { parts: event.parts.map(part => ({ ...part, startMs: time(part.startMs), endMs: time(part.endMs), speaker: speaker(part.speaker) })) } : {}) }
      ;(event.isFinal ? this.final : this.partial)(mapped)
    }
    value.provider.onPartial(ingest); value.provider.onFinal(ingest)
    value.provider.onStatus?.(error => { if (this.connection === connection) this.drop(error) })
    return connection
  }
  sendAudio(data: ArrayBuffer): void {
    if (this.stopped || this.closing || !data.byteLength) return
    if (!Number.isFinite(this.config.sampleRate) || this.config.sampleRate < 8000 || data.byteLength % 2) {
      this.drop({ error: 'Invalid PCM capture format', retryable: false }); return
    }
    const duration = data.byteLength / (this.config.sampleRate * 2) * 1000
    const frame = { data, at: this.cursorMs, duration }; this.cursorMs += duration
    if (this.connection && !this.recovering && !this.pending.length && !this.pumpTimer) { this.send(frame); return }
    this.pending.push({ ...frame, data: data.slice(0) }); this.pendingBytes += data.byteLength
    let droppedMs = 0
    while (this.pending.length && (this.pendingBytes > MAX_BUFFER_BYTES || this.cursorMs - this.pending[0].at > MAX_BUFFER_MS)) {
      const discarded = this.pending.shift()!; this.pendingBytes -= discarded.data.byteLength; droppedMs += discarded.duration
    }
    this.droppedMs += droppedMs
    this.pump()
  }
  private send(frame: Frame): boolean {
    const connection = this.connection
    if (!connection || this.recovering || this.stopped || this.closing) return false
    try {
      const last = connection.timeline.at(-1)
      if (!last || Math.abs(last.sessionMs + connection.sentMs - last.providerMs - frame.at) > .1) {
        connection.timeline.push({ providerMs: connection.sentMs, sessionMs: frame.at })
        if (connection.timeline.length > 1000) throw new Error('Transcription timeline budget exceeded')
      }
      connection.provider.sendAudio(frame.data); connection.sentMs += frame.duration
      return true
    } catch (error) { this.drop(error); return false }
  }
  private pump() {
    if (this.pumpTimer || !this.connection || this.recovering || this.stopped || this.closing || !this.pending.length) return
    const frame = this.pending.shift()!; this.pendingBytes -= frame.data.byteLength
    // A send exception is ambiguous: do NOT replay the same PCM into a new socket.
    if (!this.send(frame)) return
    // Drain at 1.25x realtime, not as an unbounded reconnect burst.
    this.pumpTimer = setTimeout(() => { this.pumpTimer = null; this.pump() }, Math.max(1, frame.duration / 1.25))
  }
  private detach(connection: Connection) {
    connection.provider.onPartial(() => {}); connection.provider.onFinal(() => {}); connection.provider.onStatus?.(() => {})
    return Promise.resolve().then(() => connection.provider.disconnect()).catch(() => {})
  }
  private drop(error: unknown) {
    if (this.stopped || this.closing || this.recovering) return
    if (!retryableTranscriptionFailure(error) || this.attempts >= MAX_SESSION_ATTEMPTS) { this.terminal(); return }
    const old = this.connection
    this.recovering = true; this.connection = null
    if (this.pumpTimer) clearTimeout(this.pumpTimer); this.pumpTimer = null
    this.notify({ state: 'gap', attempt: this.attempts, generation: this.generation })
    this.notify({ state: 'reconnecting', attempt: this.attempts + 1, generation: this.generation })
    void this.recover(old).catch(() => { if (!this.stopped && !this.closing) this.terminal() })
  }
  private async recover(old: Connection | null) {
    const episode = new AbortController(); this.episode = episode
    const timer = setTimeout(() => episode.abort(new DOMException('ASR recovery timed out', 'TimeoutError')), MAX_EPISODE_MS)
    const signal = this.config.signal ? AbortSignal.any([this.config.signal, episode.signal]) : episode.signal
    try {
      if (old) await bounded(this.detach(old), signal)
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && this.attempts < MAX_SESSION_ATTEMPTS; attempt++) {
        signal.throwIfAborted(); if (this.stopped || this.closing) return
        this.attempts++
        this.notify({ state: 'reconnecting', attempt, generation: this.generation })
        await wait(Math.round(500 * 2 ** (attempt - 1) * (.8 + Math.random() * .4)), signal)
        const connectionAbort = new AbortController()
        const connectionSignal = AbortSignal.any([signal, connectionAbort.signal])
        const timeout = setTimeout(() => connectionAbort.abort(new DOMException('ASR connection timed out', 'TimeoutError')), 8000)
        const task = this.reconnect({ ...this.config, signal: connectionSignal }, old?.name ?? 'auto')
        // Even a connector ignoring AbortSignal must not leak a late socket.
        void task.then(value => { if (connectionSignal.aborted || this.closing || this.stopped) void value.provider.disconnect().catch(() => {}) }, () => {})
        try {
          const value = await bounded(task, connectionSignal)
          signal.throwIfAborted(); if (this.stopped || this.closing) { await value.provider.disconnect(); return }
          this.generation++; this.connection = this.bind(value); this.recovering = false
          // The established connection must outlive the episode's timer. Only
          // the caller's signal or explicit disconnect retires it after success.
          this.flushLoss()
          this.notify({ state: 'reconnected', attempt, generation: this.generation })
          this.pump(); return
        } catch (failure) {
          if (signal.aborted || (!retryableTranscriptionFailure(failure) && !connectionAbort.signal.aborted)) throw failure
        } finally { clearTimeout(timeout) }
      }
      this.terminal()
    } finally { clearTimeout(timer); if (this.episode === episode) this.episode = null }
  }
  private flushLoss() {
    if (this.droppedMs > 0) this.notify({ state: 'gap', attempt: this.attempts, generation: this.generation, droppedMs: this.droppedMs })
    this.droppedMs = 0
  }
  private terminal() {
    if (this.stopped || this.closing) return
    this.flushLoss()
    this.notify({ state: 'failed', attempt: this.attempts, generation: this.generation })
    this.hardStop()
    this.status({ error: 'Transcription recovery stopped. Previously captured text is preserved; retry this audio channel.', retryable: false })
  }
  private hardStop() {
    this.stopped = true; this.episode?.abort(); this.episode = null
    this.config.signal?.removeEventListener('abort', this.onAbort)
    if (this.pumpTimer) clearTimeout(this.pumpTimer); this.pumpTimer = null
    this.pending = []; this.pendingBytes = 0
    const current = this.connection; this.connection = null
    if (current) void this.detach(current)
  }
  disconnect(): Promise<void> {
    if (this.stopPromise) return this.stopPromise
    this.closing = true; this.episode?.abort(); this.episode = null
    if (this.pumpTimer) clearTimeout(this.pumpTimer); this.pumpTimer = null
    const droppedMs = this.pending.reduce((sum, frame) => sum + frame.duration, 0)
    this.droppedMs += droppedMs; this.flushLoss()
    this.pending = []; this.pendingBytes = 0
    const current = this.connection
    this.stopPromise = (async () => {
      // Preserve normal provider final flushing; don't cancel the live signal first.
      try { await current?.provider.disconnect() }
      finally { this.stopped = true; this.connection = null; this.config.signal?.removeEventListener('abort', this.onAbort) }
    })()
    return this.stopPromise
  }
}
