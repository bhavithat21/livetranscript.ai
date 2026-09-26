import type { Clock, Timer } from '../clock'

/** Deterministic time for OUR application timers, never the browser's global clock. */
export class VirtualClock implements Clock {
  private time = 1_000_000
  private serial = 0
  private jobs = new Map<number, { due: number; run: () => void }>()
  private advancing = false
  now = () => this.time
  setTimeout = (run: () => void, delay: number): Timer => {
    if (!Number.isFinite(delay) || delay < 0 || delay > 300_000) throw new Error('Invalid simulated delay')
    const id = ++this.serial
    this.jobs.set(id, { due: this.time + delay, run })
    return id as unknown as Timer
  }
  clearTimeout = (id: Timer) => { this.jobs.delete(id as unknown as number) }
  private async flush() { for (let index = 0; index < 24; index++) await Promise.resolve() }
  async advance(milliseconds: number) {
    if (this.advancing) throw new Error('A clock advance is already in progress')
    if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 180_000) throw new Error('Invalid simulated time advance')
    this.advancing = true
    const target = this.time + milliseconds
    try {
      await this.flush()
      for (let steps = 0; ; steps++) {
        const next = [...this.jobs.entries()].filter(([, job]) => job.due <= target).sort((a, b) => a[1].due - b[1].due || a[0] - b[0])[0]
        if (!next) break
        if (steps > 50_000) throw new Error('Simulator timer budget exceeded')
        this.time = next[1].due; this.jobs.delete(next[0]); next[1].run()
        await this.flush()
      }
      this.time = target; await this.flush()
    } finally { this.advancing = false }
  }
  clear() { this.jobs.clear() }
  pending() { return this.jobs.size }
}
