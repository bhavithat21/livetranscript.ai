'use client'
import { Moon, Sun } from 'lucide-react'
import { useThemeMode } from '@/lib/transcript/useThemeMode'
import { cn } from '@/lib/utils'

// The one light/dark control, shared by the global nav and the meeting room so
// the affordance reads identically everywhere. `label` is hidden on phones in
// the room header (crowded) but the icon always carries the meaning, and the
// title/aria-pressed carry it for assistive tech.
export function ThemeToggle({
  label = false,
  className,
}: {
  label?: boolean
  className?: string
}) {
  const { isDark, toggle } = useThemeMode()
  const next = isDark ? 'light' : 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      data-active={isDark}
      className={cn(
        'inline-flex min-h-10 items-center gap-1.5 rounded-full px-3 text-sm text-black/55 data-[active=true]:text-emerald-800',
        className,
      )}
      title={`Switch to ${next} mode`}
      aria-pressed={isDark}
    >
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
      {label && <span className="hidden sm:inline">{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  )
}
