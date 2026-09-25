/** Local luminance samples only. Small changed tiles are not lost to a whole-screen threshold.
 * Cursor noise can still trigger; cadence and budgets bound paid requests.
 */
export type FrameSignal = { fingerprint: string; pixels: Uint8Array; width: number; height: number }
export type GateDecision = { capture: boolean; reason: 'initial' | 'changed' | 'unchanged' | 'settling' | 'throttled' | 'busy'; changedTiles: number }
export class KeyframeGate {
  private accepted: FrameSignal | null = null
  private candidate: FrameSignal | null = null
  private candidateAt = 0
  private lastCapture = -Infinity
  private busy = false
  constructor(readonly settleMs = 400, readonly minIntervalMs = 1500) {}
  reset() { this.accepted = null; this.candidate = null; this.candidateAt = 0; this.lastCapture = -Infinity; this.busy = false }
  sample(signal: FrameSignal, now: number): GateDecision {
    if (!Number.isFinite(now) || signal.width * signal.height !== signal.pixels.length) throw new Error('Invalid local frame signal')
    if (this.busy) return { capture: false, reason: 'busy', changedTiles: 0 }
    if (this.accepted?.fingerprint === signal.fingerprint) { this.candidate = null; return { capture: false, reason: 'unchanged', changedTiles: 0 } }
    const changedTiles = this.accepted ? changedTileCount(this.accepted, signal) : 1
    if (!changedTiles) return { capture: false, reason: 'unchanged', changedTiles }
    if (this.candidate?.fingerprint !== signal.fingerprint) { this.candidate = signal; this.candidateAt = now }
    if (now - this.candidateAt < this.settleMs) return { capture: false, reason: 'settling', changedTiles }
    if (now - this.lastCapture < this.minIntervalMs) return { capture: false, reason: 'throttled', changedTiles }
    this.busy = true; this.lastCapture = now
    return { capture: true, reason: this.accepted ? 'changed' : 'initial', changedTiles }
  }
  finish(signal: FrameSignal, accepted: boolean) { if (accepted) this.accepted = signal; this.busy = false; this.candidate = null }
}
export function changedTileCount(a: FrameSignal, b: FrameSignal): number {
  if (a.width !== b.width || a.height !== b.height) return 1
  let changed = 0
  for (let y = 0; y < a.height; y += 8) for (let x = 0; x < a.width; x += 8) {
    let pixelsChanged = 0
    for (let dy = 0; dy < 8 && y + dy < a.height; dy++) for (let dx = 0; dx < 8 && x + dx < a.width; dx++) {
      const i = (y + dy) * a.width + x + dx
      if (Math.abs(a.pixels[i] - b.pixels[i]) >= 12) pixelsChanged++
    }
    if (pixelsChanged >= 2) changed++
  }
  return changed
}
