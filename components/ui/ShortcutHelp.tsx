'use client'
import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// Shortcut cheat-sheet overlay. Press "?" anywhere (outside a text field) to open,
// Esc or click-away to close. Discoverability layer: shortcuts were previously only
// visible via button tooltips. Each page passes its own list so the sheet reflects
// what actually works on that surface.

export interface Shortcut {
  keys: string // display form, e.g. "⌘C" or "Space"
  label: string
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
// Render "Mod" as the platform's primary modifier so one list serves both OSes.
export const MOD = isMac ? '⌘' : 'Ctrl'

export function ShortcutHelp({ shortcuts }: { shortcuts: ReadonlyArray<Shortcut> }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing) return
      if (e.key === '?') {
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        // Only swallow Esc when WE own it (sheet open), so page Esc handlers
        // (exit Reader / end meeting) keep working when the sheet is closed.
        e.preventDefault()
        e.stopPropagation()
        setOpen(false)
      }
    }
    // Capture phase so our Esc runs before the page handlers when open.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={() => setOpen(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="glass w-full max-w-sm rounded-3xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-wide text-ink">Keyboard shortcuts</h2>
          <button
            onClick={() => setOpen(false)}
            className="btn-ghost inline-flex h-8 w-8 items-center justify-center rounded-full"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="flex flex-col gap-1.5">
          {shortcuts.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-black/65">{s.label}</span>
              <kbd className="rounded-md border border-black/15 bg-black/5 px-2 py-0.5 font-mono text-xs text-ink">
                {s.keys}
              </kbd>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-black/45">
          Press <kbd className="font-mono">?</kbd> anytime to toggle this.
        </p>
      </div>
    </div>
  )
}
