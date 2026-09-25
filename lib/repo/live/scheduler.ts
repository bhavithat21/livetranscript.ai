import type { Lane, Stamp } from './types'

export type JobResult<T> = { value: T; stamp: Stamp; elapsedMs: number }
/** Bounded per-lane latest-request-wins scheduler. Cancelled work cannot publish. */
export class RepoScheduler {
  private jobs = new Map<Lane, { key: string; controller: AbortController; generation: number }>()
  private completed = new Map<Lane, string>()
  private generation = 0
  private calls = 0
  constructor(private maxCalls = 120) {}
  get requests() { return this.calls }
  get running() { return this.jobs.size }
  cancel(lane?: Lane) {
    for (const [key, job] of this.jobs) if (!lane || lane === key) { job.controller.abort(); this.jobs.delete(key) }
  }
  async run<T>(lane: Lane, stamp: Stamp, run: (signal: AbortSignal) => Promise<T>, publish: (result: JobResult<T>) => void, deadlineMs = 28000): Promise<'completed' | 'duplicate' | 'cancelled' | 'budget'> {
    const key = JSON.stringify(stamp)
    if (this.jobs.get(lane)?.key === key || this.completed.get(lane) === key) return 'duplicate'
    if (this.calls >= this.maxCalls) return 'budget'
    this.cancel(lane)
    // At most one speech job and one expensive code/review job at a time.
    if (lane === 'plan') this.cancel('review')
    if (lane === 'review') this.cancel('plan')
    const controller = new AbortController(), generation = ++this.generation
    this.jobs.set(lane, { key, controller, generation }); this.calls++
    const timeout = setTimeout(() => controller.abort(), deadlineMs)
    const started = performance.now()
    try {
      const value = await run(controller.signal)
      if (controller.signal.aborted || this.jobs.get(lane)?.generation !== generation) return 'cancelled'
      this.completed.set(lane, key)
      publish({ value, stamp, elapsedMs: Math.round(performance.now() - started) })
      return 'completed'
    } catch (error) {
      if (controller.signal.aborted || this.jobs.get(lane)?.generation !== generation) return 'cancelled'
      // Failures are not retried automatically for the same state: prevents paid loops.
      this.completed.set(lane, key)
      throw error
    } finally {
      clearTimeout(timeout)
      if (this.jobs.get(lane)?.generation === generation) this.jobs.delete(lane)
    }
  }
  retry(lane: Lane) { this.completed.delete(lane) }
}
