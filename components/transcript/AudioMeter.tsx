export function AudioMeter({ level }: { level: number }) {
  const pct = Math.min(100, Math.round(level * 300))
  return (
    <div className="h-2 w-40 overflow-hidden rounded-full bg-black/10" aria-hidden>
      <div
        className="h-full bg-emerald-600 transition-[width] duration-75"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
