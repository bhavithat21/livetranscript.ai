'use client'
import Link from 'next/link'
import { Home, LayoutGrid, Mic, Users } from 'lucide-react'

// Compact navigation for the FOCUSED pages (record / room / session) where the
// full AppNav is hidden. A glass logo pill that opens a dropdown so you can jump
// home or between sections from anywhere — no page is a dead end. Native <details>
// = click-out + Esc close for free, no state, no dependency.
const LINKS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/dashboard', label: 'Library', icon: LayoutGrid },
  { href: '/record', label: 'New transcript', icon: Mic },
  { href: '/room/new', label: 'New meeting', icon: Users },
]

export function HomeMenu() {
  return (
    <details className="group relative">
      <summary className="glass glass-interactive flex cursor-pointer list-none items-center gap-1.5 rounded-full py-1.5 pl-3 pr-2.5 [&::-webkit-details-marker]:hidden">
        <span className="font-[family-name:var(--font-serif)] text-base font-semibold tracking-[-0.01em]">
          Live<span className="text-[color:var(--signal)]">T</span>
        </span>
        <svg width="12" height="12" viewBox="0 0 12 12" className="text-black/40 transition-transform group-open:rotate-180" aria-hidden>
          <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>
      <nav className="glass absolute left-0 z-50 mt-2 w-52 rounded-2xl p-1.5 shadow-lg" aria-label="Sections">
        {LINKS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 rounded-xl px-3 py-2 text-sm text-black/70 transition-colors hover:bg-black/5 hover:text-ink"
          >
            <Icon size={16} className="text-black/40" />
            {label}
          </Link>
        ))}
      </nav>
    </details>
  )
}
