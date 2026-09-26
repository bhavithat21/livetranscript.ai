import type { TrackingReceipt } from './tracking'
/** Source-normalized visual locations, never line-height extrapolation.
 * Vision coordinates remain estimates, not calibrated correctness probabilities.
 */
export type Rect = { x: number; y: number; width: number; height: number }
export type LineRect = { line: number; rect: Rect }
export type SurfaceFrame = {
  key: string; sourceId: string; sampledAt: number; focused: boolean
  captureId?: string; observationKey?: string; tracking?: TrackingReceipt | null; captureMs?: number
  viewport: { width: number; height: number }; source: Rect
}
export function validRect(r: Rect): boolean {
  return [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0
}
export function parseLineRects(raw: unknown, startLine: number | null, lines: string[]): LineRect[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length > 80) throw new Error('Invalid visual line anchors')
  const seen = new Set<number>()
  return raw.map(item => {
    if (!item || typeof item !== 'object' || Object.keys(item).some(k => !['line','rect'].includes(k))) throw new Error('Invalid line anchor')
    const {line, rect} = item
    if (!Number.isSafeInteger(line) || startLine === null || line < startLine || line >= startLine + lines.length || seen.has(line)) throw new Error('Anchor must identify a unique observed line')
    if (!rect || typeof rect !== 'object' || Object.keys(rect).sort().join(',') !== 'height,width,x,y' || !validRect(rect) || rect.x < 0 || rect.y < 0 || rect.x + rect.width > 1.000001 || rect.y + rect.height > 1.000001) throw new Error('Anchor must fit the source screenshot')
    seen.add(line)
    return { line, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } }
  })
}
export function project(rect: Rect, surface: SurfaceFrame): Rect | null {
  const v=surface.viewport,s=surface.source
  if (!validRect(rect)||!validRect(s)||!Number.isFinite(v.width)||!Number.isFinite(v.height)||v.width<320||v.height<240) return null
  const result={x:s.x+rect.x*s.width,y:s.y+rect.y*s.height,width:rect.width*s.width,height:rect.height*s.height}
  if(result.x<0||result.y<0||result.x+result.width>v.width||result.y+result.height>v.height) return null
  return result
}
export function intersects(a: Rect,b: Rect): boolean {return a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y}
export function placeCallout(target: Rect, viewport: {width:number;height:number}, width=360, height=228): {rect:Rect;side:'right'|'left'|'below'|'above'}|null {
  if(!validRect(target)||viewport.width<320||viewport.height<240) return null
  const gap=16,margin=12,w=Math.min(width,viewport.width-margin*2)
  const y=Math.max(margin,Math.min(target.y-146,viewport.height-height-margin))
  const x=Math.max(margin,Math.min(target.x,viewport.width-w-margin))
  const candidates=[
    {side:'right' as const,rect:{x:target.x+target.width+gap,y,width:w,height}},
    {side:'left' as const,rect:{x:target.x-gap-w,y,width:w,height}},
    {side:'below' as const,rect:{x,y:target.y+target.height+gap,width:w,height}},
    {side:'above' as const,rect:{x,y:target.y-height-gap,width:w,height}},
  ]
  return candidates.find(({rect:r})=>r.x>=margin&&r.y>=margin&&r.x+r.width<=viewport.width-margin&&r.y+r.height<=viewport.height-margin&&!intersects(r,target))??null
}
