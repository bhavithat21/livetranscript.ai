'use client'
import { useCallback, useEffect, useState } from 'react'

// Per-device transcript text-size preference. A multiplier applied to the reading
// body so people can enlarge/shrink captions for comfort. Persisted in
// localStorage so it sticks across sessions and screens (record, meeting, reader).
const KEY = 'lt.textScale'
export const MIN_SCALE = 0.85
export const MAX_SCALE = 1.6
const STEP = 0.15
const DEFAULT_SCALE = 1

const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(n * 100) / 100))

export function useTextScale() {
  const [scale, setScale] = useState(DEFAULT_SCALE)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) {
        const parsed = parseFloat(raw)
        if (Number.isFinite(parsed)) setScale(clamp(parsed))
      }
    } catch {
      /* storage disabled — default scale */
    }
  }, [])

  const set = useCallback((next: number) => {
    const c = clamp(next)
    setScale(c)
    try {
      localStorage.setItem(KEY, String(c))
    } catch {
      /* ignore */
    }
  }, [])

  const inc = useCallback(() => set(scale + STEP), [scale, set])
  const dec = useCallback(() => set(scale - STEP), [scale, set])

  return { scale, inc, dec, canInc: scale < MAX_SCALE, canDec: scale > MIN_SCALE }
}
