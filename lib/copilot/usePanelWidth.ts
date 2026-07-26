'use client'
import { useCallback, useState } from 'react'

// Shared width state for the Ask panel. Lifted OUT of CopilotPanel so the page
// can reserve the same width as right-padding on its content — that's what turns
// the panel from a transcript-covering overlay into a true side-by-side split.
// One instance lives on the page and is passed to the panel, so dragging the
// panel's edge and the page's reserved space stay in sync.
//
// Persisted to localStorage so the chosen width sticks across sessions. Desktop
// only — on mobile the panel is a full-screen drawer and this width is ignored.

const PANEL_WIDTH_KEY = 'lt.copilot.width'
const DEFAULT_WIDTH = 384 // 24rem — the original fixed width
const MIN_WIDTH = 320
const MAX_WIDTH = 900

function clampWidth(px: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(px)))
}

function readSavedWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_WIDTH // SSR renders the default
  try {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY))
    return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

export type PanelWidth = {
  width: number
  onResizeStart: (e: React.PointerEvent) => void
}

export function usePanelWidth(): PanelWidth {
  // Lazy initializer reads the saved width once (browser only) — no effect +
  // setState hop, and SSR/first paint uses DEFAULT_WIDTH.
  const [width, setWidth] = useState<number>(readSavedWidth)

  const onResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    // The panel is right-anchored, so width = distance from the viewport's right
    // edge to the pointer. Dragging the left edge leftward widens it.
    const move = (ev: PointerEvent) => {
      setWidth(clampWidth(window.innerWidth - ev.clientX))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      // Persist inside the updater so we save the final committed value.
      setWidth((w) => {
        try {
          localStorage.setItem(PANEL_WIDTH_KEY, String(w))
        } catch {
          /* ignore */
        }
        return w
      })
    }
    document.body.style.userSelect = 'none' // no text selection while dragging
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  return { width, onResizeStart }
}
