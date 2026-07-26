'use client'
import { useEffect, useRef, useCallback, useState } from 'react'

// Periodic screen capture for the coding copilot. While enabled, grabs a frame
// from the screen stream at a configurable interval, skipping unchanged frames
// (the grabFrame diff-gate handles that). When the screen DOES change, fires the
// onChange callback with the new frame so the coding tab can auto-submit the
// problem to the AI.
//
// Frequency management: default 10s interval. The caller can adjust or pause.
// Each grab is cheap (~2ms canvas draw + JPEG encode); the expensive part is the
// AI call which only fires when the frame actually changed (grabFrame returns null
// for unchanged screens).

const DEFAULT_INTERVAL_MS = 500

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

  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => {
      const frame = grabRef.current()
      if (frame) onChangeRef.current(frame)
    }, intervalMs)
    return () => clearInterval(id)
  }, [enabled, intervalMs])
}
