/** Screenshot-only bridge contract. A visual match is not semantic correctness.
 * Native retains the reference pixels; JS supplies only bounded image geometry.
 */
import type { CoachState } from '../types'
import type { Rect, SurfaceFrame } from './geometry'
import { validRect, parseTrackingRegions } from './geometry'
import { currentSteps, type EditStep } from './steps'
import { hashText } from '../validation'

export type VisualSeed = { anchorId: string; captureId: string; target: Rect; context: Rect; search: Rect; identity: Rect; watch: Rect[] }
export type TrackingReceipt = {
  anchorId: string; status: string; rect: Rect | null; dx: number; dy: number
  processingMs: number; probes: number; semanticDirty: boolean
}
export const anchorKey = (state: CoachState, step: EditStep, sourceId = '') => hashText(JSON.stringify([
  sourceId, state.sessionId, state.question?.id, state.task.version, state.codeVersion,
  step.id, step.fileVersion, step.before, step.after,
]))
const insideUnit = (r: Rect) => validRect(r) && r.x >= 0 && r.y >= 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001
const union = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y))
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y }
}
function expand(r: Rect, x: number, y: number): Rect {
  const left = Math.max(0, r.x - x), top = Math.max(0, r.y - y)
  return { x: left, y: top, width: Math.min(1, r.x + r.width + x) - left, height: Math.min(1, r.y + r.height + y) - top }
}
export function parseTrackingReceipt(raw: unknown): TrackingReceipt | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as TrackingReceipt
  if (typeof r.anchorId !== 'string' || !r.anchorId || r.anchorId.length > 300 ||
    !['tracking','lost','edited','ambiguous','layout-changed','identity-changed','budget','unfocused'].includes(r.status) ||
    ![r.dx,r.dy,r.processingMs,r.probes].every(Number.isFinite) || r.processingMs < 0 || r.probes < 0 ||
    typeof r.semanticDirty !== 'boolean' || (r.rect !== null && !insideUnit(r.rect))) return null
  if (r.status === 'tracking' && r.rect === null) return null
  return { ...r, rect: r.rect ? { ...r.rect } : null }
}
export function buildVisualSeed(state: CoachState, step: EditStep, reference: SurfaceFrame | null): VisualSeed | null {
  if (!reference?.captureId || !currentSteps(state).some(s => s.id === step.id)) return null
  const screen = state.lastScreen
  if (!screen || reference.observationKey !== hashText(JSON.stringify(screen.observation)) || state.sources.find(s => s.id === screen.sourceId)?.origin !== 'screen') return null
  const files = screen.observation.files.filter(f => f.path === step.path && f.confidence >= .95 && f.startLine !== null)
  const patch = state.patches.find(p => p.id === step.patchId)
  if (!patch || !state.files.some(f => f.path === step.path && f.version === step.fileVersion)) return null
  const text = new Map<number, string>()
  files.forEach(f => f.lines.forEach((line,i) => text.set(f.startLine! + i,line)))
  if (!patch.before.split('\n').every((line,i) => text.get(patch.startLine + i) === line)) return null
  const rows = files.flatMap(f => f.lineRects ?? [])
  if (new Set(rows.map(r => r.line)).size !== rows.length || rows.some(r => !insideUnit(r.rect))) return null
  const count = step.operation.startsWith('insert-') ? 1 : Math.max(1,step.before.split('\n').length)
  const targetRows = rows.filter(r => r.line >= step.anchorLine && r.line < step.anchorLine + count)
  const nearby = rows.filter(r => r.line >= step.anchorLine - 3 && r.line < step.anchorLine + count + 3)
  if (targetRows.length !== count || nearby.length < count + 2) return null
  const target = union(targetRows.map(r => r.rect))
  const context = expand(union(nearby.map(r => r.rect)), .004, .002)
  const regionInputs = files.map(f=>f.trackingRegions).filter(Boolean)
  if (!regionInputs.length || regionInputs.some(v=>JSON.stringify(v)!==JSON.stringify(regionInputs[0]))) return null
  let regions
  try { regions=parseTrackingRegions(regionInputs[0]) } catch { return null }
  if (!regions) return null
  const search=regions.editor,identity=regions.identity
  if (identity.height * reference.source.height < 12 ||
      context.x < search.x || context.y < search.y || context.x + context.width > search.x + search.width + 1e-6 || context.y + context.height > search.y + search.height + 1e-6) return null
  return { anchorId: anchorKey(state,step,reference.sourceId), captureId: reference.captureId, target, context, search, identity, watch:regions.watch }
}
export function trackedRect(state: CoachState, step: EditStep, frame: SurfaceFrame, now: number): Rect | null {
  const receipt = frame.tracking
  if (!receipt || receipt.anchorId !== anchorKey(state,step,frame.sourceId) || receipt.status !== 'tracking' || receipt.semanticDirty || !frame.focused ||
      now - frame.sampledAt > 450 || frame.sampledAt - now > 1000 || !currentSteps(state).some(s => s.id === step.id)) return null
  return receipt.rect
}
/** Diagnostic timing only. Not a prediction of correct source attachment. */
export class TrackingMetrics {
  private frames = 0; private statuses: Record<string,number> = {}; private work: number[] = []; private capture: number[] = []
  private first = 0; private last = 0; private reused = 0
  record(frame: SurfaceFrame, captureMs: number) {
    if (!frame.tracking) return
    this.frames++; this.first ||= frame.sampledAt; this.last = frame.sampledAt
    const r = frame.tracking; this.statuses[r.status] = (this.statuses[r.status] ?? 0) + 1
    this.work.push(r.processingMs); this.capture.push(captureMs)
    if (this.work.length > 240) { this.work.shift(); this.capture.shift() }
  }
  reuse() { this.reused++ }
  report() {
    const summary = (values: number[]) => {
      const sorted = [...values].sort((a,b) => a-b), at = (p: number) => sorted.length ? sorted[Math.ceil(sorted.length*p)-1] : null
      return { samples: sorted.length, p50Ms: at(.5), p95Ms: at(.95), maxMs: sorted.at(-1) ?? null }
    }
    return { schema: 'screenshot-tracking-v1', input: 'selected-window-pixels', frames: this.frames, statuses: { ...this.statuses }, locallyReusedFrames: this.reused,
      observationDurationMs: Math.max(0,this.last-this.first), kernel: summary(this.work), nativeCaptureAndProcessing: summary(this.capture),
      timingWindow: 'latest-240-tracked-frames', sourceLocalizationError: null, correctAttachmentRate: null, speechAnswerAccuracy: null }
  }
}
