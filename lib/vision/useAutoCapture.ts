'use client'
import { useEffect, useRef } from 'react'

// Periodic screen capture for the coding copilot. While enabled, grabs a frame
// from the screen stream at a configurable interval, skipping unchanged frames
// (the grabFrame diff-gate handles that). Fires onChange with a frame only once
// the screen has CHANGED and then SETTLED — so the coding tab auto-submits a
// finished problem, not a half-typed one.
//
// Settle gate: grabFrame returns the frame when the screen changed since the last
// grab, else null. A change arms a pending frame; we fire only after the next
// grab comes back null (screen held still) — i.e. changed THEN quiet. This kills
// the "extract a half-typed problem" failure while still catching a problem the
// instant it stops changing. Each grab is cheap (~2ms canvas draw + JPEG encode);
// the expensive vision call only fires on a settled change. After a fire we hold
// off for a cooldown so a screen that keeps churning can't stack rapid calls.

// Poll faster than the old 4s so "settled" is detected within a beat of the
// screen going quiet — grabs are cheap, only the settled fire costs a vision call.
const DEFAULT_INTERVAL_MS = 1_200
const COOLDOWN_MS = 15_000
// How many consecutive unchanged grabs (after a change) count as "settled".
const SETTLE_GRABS = 1

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
  // The most recent changed frame, awaiting the screen to go quiet before we fire.
  const pendingRef = useRef<string | null>(null)
  const stillCountRef = useRef(0)

  useEffect(() => {
    if (!enabled) {
      pendingRef.current = null
      stillCountRef.current = 0
      return
    }
    const id = setInterval(() => {
      if (Date.now() < cooldownUntilRef.current) return
      const frame = grabRef.current()
      if (frame) {
        // Screen changed since last grab — (re)arm on the newest frame and wait
        // for it to stop changing. A still-typing screen keeps landing here, so
        // stillCount never climbs and we never fire mid-edit.
        pendingRef.current = frame
        stillCountRef.current = 0
        return
      }
      // Unchanged grab. If a change is pending, the screen is holding still —
      // once it's been quiet long enough, fire the settled frame.
      if (pendingRef.current && ++stillCountRef.current >= SETTLE_GRABS) {
        const settled = pendingRef.current
        pendingRef.current = null
        stillCountRef.current = 0
        cooldownUntilRef.current = Date.now() + COOLDOWN_MS
        onChangeRef.current(settled)
      }
    }, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
}
