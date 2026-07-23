'use client'
import { Minus, Plus } from 'lucide-react'

// Compact A− / A+ control for adjusting transcript text size. Sits in the live
// docks/headers; wired to useTextScale (localStorage-persisted). The "A" glyphs
// signal text sizing at a glance; 44px-friendly tap targets.
export function TextSizeControl({
  onDec,
  onInc,
  canDec,
  canInc,
}: {
  onDec: () => void
  onInc: () => void
  canDec: boolean
  canInc: boolean
}) {
  return (
    <div
      className="glass flex items-center rounded-full p-0.5"
      role="group"
      aria-label="Transcript text size"
    >
      <button
        onClick={onDec}
        disabled={!canDec}
        aria-label="Decrease text size"
        title="Smaller text"
        className="flex h-9 w-9 items-center justify-center rounded-full text-black/60 transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-30"
      >
        <Minus size={14} />
        <span className="text-xs font-semibold">A</span>
      </button>
      <button
        onClick={onInc}
        disabled={!canInc}
        aria-label="Increase text size"
        title="Larger text"
        className="flex h-9 w-9 items-center justify-center rounded-full text-black/60 transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-30"
      >
        <Plus size={14} />
        <span className="text-sm font-semibold">A</span>
      </button>
    </div>
  )
}
