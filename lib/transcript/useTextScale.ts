'use client'
import { useCallback } from 'react'
import { useStoredPreference } from '@/lib/browser/useStoredPreference'

// Per-device transcript text-size preference. A multiplier applied to the reading
// body so people can enlarge/shrink captions for comfort. Persisted in
// localStorage so it sticks across sessions and screens (record, meeting, reader).
const KEY = 'lt.textScale'
export const MIN_SCALE = 0.85
export const MAX_SCALE = 2
const STEP = 0.15
const DEFAULT_SCALE = 1

const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(n * 100) / 100))
const parseScale = (raw: string) => {
  const parsed = parseFloat(raw)
  return Number.isFinite(parsed) ? clamp(parsed) : DEFAULT_SCALE
}

export function useTextScale() {
  const { value: scale, setValue } = useStoredPreference(KEY, DEFAULT_SCALE, parseScale)

  const set = useCallback((next: number) => {
    setValue(Number.isFinite(next) ? clamp(next) : DEFAULT_SCALE)
  }, [setValue])

  const inc = useCallback(() => set(scale + STEP), [scale, set])
  const dec = useCallback(() => set(scale - STEP), [scale, set])

  return { scale, inc, dec, set, reset: () => set(DEFAULT_SCALE), canInc: scale < MAX_SCALE, canDec: scale > MIN_SCALE }
}
