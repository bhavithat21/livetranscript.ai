'use client'
import { useEffect, useRef, useState } from 'react'
import { Mic } from 'lucide-react'

const BARS = 28

// Real audio waveform: keeps a rolling buffer of the actual mic RMS `level`
// (not simulated). New samples push in from the right and scroll left, so the
// bars trace what was really spoken. Emerald signal palette; idle = flat + dim.
export function Waveform({ level, active }: { level: number; active: boolean }) {
  const [bars, setBars] = useState<number[]>(() => Array(BARS).fill(0))
  const levelRef = useRef(level)
  levelRef.current = level

  useEffect(() => {
    if (!active) {
      setBars(Array(BARS).fill(0))
      return
    }
    const id = setInterval(() => {
      setBars((prev) => {
        // RMS is small (~0..0.3 typical speech); scale to a visible 0..1 height.
        const h = Math.min(1, levelRef.current * 3.2)
        return [...prev.slice(1), h]
      })
    }, 60)
    return () => clearInterval(id)
  }, [active])

  return (
    <div
      className="flex h-9 items-center gap-[3px]"
      role="img"
      aria-label={active ? 'Live audio level' : 'Microphone idle'}
    >
      <Mic
        className={active ? 'text-emerald-700' : 'text-black/30'}
        size={16}
        aria-hidden
      />
      <div className="flex h-full items-center gap-[3px]">
        {bars.map((h, i) => (
          <span
            key={i}
            className="w-[3px] rounded-full transition-[height,opacity] duration-75"
            style={{
              height: `${Math.max(3, h * 32)}px`,
              background: active ? '#0f766e' : 'rgba(20,21,26,0.15)',
              opacity: active ? 0.5 + h * 0.5 : 0.4,
            }}
          />
        ))}
      </div>
    </div>
  )
}
