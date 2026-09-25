import { afterEach, describe, expect, it, vi } from 'vitest'
import { RepoScheduler } from './scheduler'
import { KeyframeGate, frameDifference } from './keyframes'
const stamp = { sessionId: 's', questionId: 'q', evidenceRevision: 1, codeRevision: 1 }
afterEach(() => vi.useRealTimers())
describe('repository lanes', () => {
  it('runs speech and code in parallel', async () => { const s = new RepoScheduler(); let finish!: (s: string) => void; const out: string[] = []; const plan = s.run('plan', stamp, () => new Promise<string>(r => { finish = r }), r => out.push(r.value)); await s.run('say', stamp, async () => 'say', r => out.push(r.value)); expect(out).toEqual(['say']); finish('plan'); await plan; expect(out).toEqual(['say', 'plan']) })
  it('answers an unchanged stamp once, even after async completion', async () => { const s = new RepoScheduler(), f = vi.fn(async () => 'one'), pub = vi.fn(); await s.run('say', stamp, f, pub); expect(await s.run('say', stamp, f, pub)).toBe('duplicate'); expect(f).toHaveBeenCalledTimes(1); expect(pub).toHaveBeenCalledTimes(1) })
  it('discards stale completion even if the provider ignores abort', async () => { const s = new RepoScheduler(), pub = vi.fn(); let resolve!: (x: string) => void; const old = s.run('plan', stamp, () => new Promise<string>(r => { resolve = r }), pub); await s.run('plan', { ...stamp, evidenceRevision: 2 }, async () => 'new', pub); resolve('old'); expect(await old).toBe('cancelled'); expect(pub).toHaveBeenCalledTimes(1); expect(pub.mock.calls[0][0].value).toBe('new') })
  it('does not loop on provider errors; explicit retry is required', async () => { const s = new RepoScheduler(), f = vi.fn(async () => { throw new Error('failed') }); await expect(s.run('plan', stamp, f, vi.fn())).rejects.toThrow(); expect(await s.run('plan', stamp, f, vi.fn())).toBe('duplicate'); s.retry('plan'); await expect(s.run('plan', stamp, f, vi.fn())).rejects.toThrow(); expect(f).toHaveBeenCalledTimes(2) })
  it('limits paid calls per session', async () => { const s = new RepoScheduler(1); await s.run('say', stamp, async () => 1, vi.fn()); expect(await s.run('plan', stamp, async () => 1, vi.fn())).toBe('budget') })
  it('aborts at the lane deadline', async () => { vi.useFakeTimers(); const s = new RepoScheduler(); const pending = s.run('plan', stamp, signal => new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))), vi.fn(), 100); await vi.advanceTimersByTimeAsync(101); expect(await pending).toBe('cancelled') })
  it('cancels coding when review supersedes it', async () => { const s = new RepoScheduler(); let stopped = false; const old = s.run('plan', stamp, signal => new Promise<string>((_, reject) => signal.addEventListener('abort', () => { stopped = true; reject(new Error('cancelled')) })), vi.fn()); await s.run('review', stamp, async () => 'review', vi.fn()); expect(stopped).toBe(true); expect(await old).toBe('cancelled') })
})
describe('local keyframes', () => {
  const pixels = () => new Uint8ClampedArray(128 * 128 * 4)
  it('waits for stability and remembers the accepted frame', () => { const g = new KeyframeGate(), p = pixels(); expect(g.observe(p, 0)).toBe('settling'); expect(g.observe(p, 200)).toBe('settling'); expect(g.observe(p, 400)).toBe('capture'); g.accept(p, 400); expect(g.observe(p, 2000)).toBe('unchanged') })
  it('looks at changed tiles rather than a whole-screen average', () => { const a = pixels(), b = pixels(); for (let row = 0; row < 16; row++) for (let col = 0; col < 16; col++) { const i = (row * 128 + col) * 4; b[i] = 255; b[i + 1] = 255; b[i + 2] = 255 } expect(frameDifference(a, b)).toBe(1) })
  it('enforces a capture cooldown', () => { const g = new KeyframeGate(), a = pixels(), b = pixels().fill(255); g.observe(a, 0); g.accept(a, 400); expect(g.observe(b, 500)).toBe('settling'); expect(g.observe(b, 900)).toBe('cooldown'); expect(g.observe(b, 1800)).toBe('capture') })
})
