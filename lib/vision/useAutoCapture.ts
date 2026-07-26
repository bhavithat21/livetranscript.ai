'use client'
import { useEffect, useRef } from 'react'

// Periodic screen capture for the coding copilot. While enabled, grabs a frame
// from the screen stream at a configurable interval, skipping unchanged frames
// (the grabFrame diff-gate handles that). When the screen DOES change, fires the
// onChange callback with the new frame so the coding tab can auto-submit the
// problem to the AI.
//
// Frequency management: default 4s interval — fast enough to catch a problem
// appearing on screen, slow enough not to bill a vision call on every keystroke.
// Each grab is cheap (~2ms canvas draw + JPEG encode); the expensive part is the
// AI call which only fires when the frame actually changed (grabFrame returns null
// for unchanged screens). After a frame fires we hold off for a cooldown so a
// screen that keeps changing (typing, scrolling) can't stack up rapid calls.

const DEFAULT_INTERVAL_MS = 4_000
const COOLDOWN_MS = 15_000

export function useAutoCapture(
  enabled: boolean,
  grabFrame: () => string | null,
  onChange: (frame: string) => void,
  intervalMs = DEFAULT_INTERVAL_MS,
) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const grabRef = useRef(grabFrame)
  grabRef.current = grabFrame
  const cooldownUntilRef = useRef(0)

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      if (Date.now() < cooldownUntilRef.current) return
      const frame = grabRef.current()
      if (frame) {
        cooldownUntilRef.current = Date.now() + COOLDOWN_MS
        onChangeRef.current(frame)
      }
    }, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
}
