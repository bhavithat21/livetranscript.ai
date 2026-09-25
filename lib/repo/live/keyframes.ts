export type FrameDecision = 'unchanged' | 'settling' | 'cooldown' | 'capture'
/** Tile-level local comparison notices a small changed editor region, not just whole-screen MAD. */
export function frameDifference(a: Uint8ClampedArray, b: Uint8ClampedArray, width = 128): number {
  if (a.length !== b.length || a.length === 0) return 1
  const tiles = new Map<number, { sum: number; count: number }>()
  for (let i = 0; i < a.length; i += 4) {
    const pixel = i / 4, x = pixel % width, y = Math.floor(pixel / width), id = Math.floor(y / 16) * Math.ceil(width / 16) + Math.floor(x / 16)
    const tile = tiles.get(id) ?? { sum: 0, count: 0 }
    tile.sum += (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 765
    tile.count++; tiles.set(id, tile)
  }
  return Math.max(0, ...[...tiles.values()].map(t => t.sum / t.count))
}
export class KeyframeGate {
  private previous: Uint8ClampedArray | null = null
  private accepted: Uint8ClampedArray | null = null
  private changedAt = 0
  private acceptedAt = -Infinity
  constructor(readonly settleMs = 400, readonly minIntervalMs = 1400, readonly threshold = .025) {}
  observe(pixels: Uint8ClampedArray, now: number): FrameDecision {
    if (!this.previous || frameDifference(pixels, this.previous) >= this.threshold) { this.previous = new Uint8ClampedArray(pixels); this.changedAt = now; return 'settling' }
    if (this.accepted && frameDifference(pixels, this.accepted) < this.threshold) return 'unchanged'
    if (now - this.changedAt < this.settleMs) return 'settling'
    if (now - this.acceptedAt < this.minIntervalMs) return 'cooldown'
    return 'capture'
  }
  accept(pixels: Uint8ClampedArray, now: number) { this.accepted = new Uint8ClampedArray(pixels); this.acceptedAt = now }
  reset() { this.previous = null; this.accepted = null; this.acceptedAt = -Infinity; this.changedAt = 0 }
}
