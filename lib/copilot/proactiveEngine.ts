import { systemClock, type Clock, type Timer } from '../coach/clock'
import { questionCandidates, type QuestionCandidate } from './questionDetection'

export type QuestionInput = string | { text: string; endOfTurn?: boolean; activityKey?: string }
export const questionInputText = (input: QuestionInput): string => typeof input === 'string' ? input : input.text

/** Shared by useProactive (Live/Mock) and the realtime simulator. No model access. */
export class ProactiveEngine {
  private seen = new Set<string>()
  private queue: QuestionCandidate[] = []
  private pending: { key: string; since: number } | null = null
  private snapshot = ''
  private activityKey: string | undefined
  private timer: Timer | null = null
  private flight = 0
  private serial = 0
  private epoch = 0
  private running = false
  constructor(private getTranscript: () => QuestionInput, private onQuestion: (question: string) => void | Promise<void>,
    private options: { latestWins?: boolean; onAsked?: (question: string) => void; onError?: (error: string | null) => void } = {}, private clock: Clock = systemClock) {}
  start() {
    if (this.running) return
    this.running = true; this.snapshot = ''; this.epoch++
    this.schedule()
  }
  stop() {
    this.running = false; this.epoch++
    if (this.timer !== null) this.clock.clearTimeout(this.timer)
    this.timer = null; this.queue = []; this.pending = null; this.flight = 0
  }
  private schedule() { this.timer = this.clock.setTimeout(() => { this.timer = null; this.tick(); if (this.running) this.schedule() }, 300) }
  private dispatch(candidate: QuestionCandidate) {
    const token = ++this.serial, epoch = this.epoch
    this.flight = token; this.options.onError?.(null); this.options.onAsked?.(candidate.question)
    let result: void | Promise<void>
    try { result = this.onQuestion(candidate.question) } catch (failure) { result = Promise.reject(failure) }
    void Promise.resolve(result).catch(failure => {
      if (this.running && this.epoch === epoch && this.flight === token) this.options.onError?.(failure instanceof Error ? failure.message : 'Could not answer this question.')
    }).finally(() => { if (this.running && this.epoch === epoch && this.flight === token) this.flight = 0 })
  }
  private tick() {
    if (!this.running) return
    let input: QuestionInput
    try { input = this.getTranscript() } catch { this.options.onError?.('Transcript unavailable.'); return }
    const transcript = questionInputText(input), endpoint = typeof input === 'string' ? undefined : input.endOfTurn
    const activity = typeof input === 'string' ? undefined : input.activityKey
    const activeSpeechChanged = activity !== this.activityKey && endpoint === false
    this.activityKey = activity
    if (transcript !== this.snapshot || this.pending || activeSpeechChanged) {
      this.snapshot = transcript
      const candidate = questionCandidates(transcript).at(-1)
      if (!candidate || this.seen.has(candidate.key)) this.pending = null
      else {
        const now = this.clock.now()
        if (!this.pending || this.pending.key !== candidate.key || activeSpeechChanged) this.pending = { key: candidate.key, since: now }
        // Explicit ASR endpoints are fast. Stable text is not end-of-speech:
        // interim activity keeps the turn open; a lost endpoint has a bounded
        // silence fallback, rather than billing every phrase or waiting forever.
        const settleMs = endpoint === false ? 2500 : endpoint === true || candidate.complete ? 300 : 900
        if (now - this.pending.since >= settleMs) {
          this.seen.add(candidate.key)
          if (this.seen.size > 128) this.seen.delete(this.seen.values().next().value!)
          this.pending = null
          this.queue = this.queue.filter(item => item.origin !== candidate.origin)
          this.queue.push(candidate)
          if (this.queue.length > 4) this.queue.shift()
        }
      }
    }
    if (this.queue.length && (!this.flight || this.options.latestWins)) {
      const candidate = this.options.latestWins ? this.queue.at(-1)! : this.queue[0]
      this.queue = this.options.latestWins ? [] : this.queue.slice(1)
      this.dispatch(candidate)
    }
  }
}
