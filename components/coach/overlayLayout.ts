import type { OverlayRect } from './OverlayPanel'
export type OverlayLayout = Record<'next' | 'say' | 'code' | 'writing' | 'transcript', OverlayRect>
const keys = ['next', 'say', 'code', 'writing', 'transcript'] as const

/** Stored preferences are untrusted, versioned data. Missing panels are normal
 * after an upgrade; a valid JSON value is not necessarily a complete layout. */
export function restoreOverlayLayout(raw: string | null, defaults: OverlayLayout): OverlayLayout {
  let saved: unknown
  try { saved = raw ? JSON.parse(raw) : null } catch { return defaults }
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaults
  const result = { ...defaults }
  for (const key of keys) {
    const value = (saved as Record<string, unknown>)[key]
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const rect = { ...defaults[key] }
    for (const field of ['x', 'y', 'width', 'height', 'opacity'] as const) {
      const n = (value as Record<string, unknown>)[field]
      if (typeof n !== 'number' || !Number.isFinite(n)) continue
      const [min, max] = field === 'opacity' ? [20, 96] : field === 'width' ? [260, 900] : field === 'height' ? [96, 900] : [0, 4000]
      rect[field] = Math.max(min, Math.min(max, n))
    }
    result[key] = rect
  }
  return result
}
