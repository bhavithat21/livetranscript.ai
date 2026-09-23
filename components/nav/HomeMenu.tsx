'use client'
import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { ChevronDown, Home, FileText, Mic, MonitorUp, Settings, Sparkles, Users, GraduationCap, FlaskConical } from 'lucide-react'
import { Wordmark } from './Wordmark'

// Compact navigation for focused recording, meeting, and reading routes.
const LINKS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/interview', label: 'Live interview', icon: Mic },
  { href: '/interview#mock', label: 'Mock Lab', icon: FlaskConical },
  { href: '/copilot', label: 'AI workspace', icon: Sparkles },
  { href: '/practice', label: 'Practice', icon: GraduationCap },
  { href: '/dashboard', label: 'Transcripts', icon: FileText },
  { href: '/record', label: 'New transcript', icon: Mic },
  { href: '/room/new', label: 'New meeting', icon: Users },
  { href: '/remote', label: 'Remote assist', icon: MonitorUp },
  { href: '/settings', label: 'Settings', icon: Settings },
]

export function HomeMenu() {
  const menu = useRef<HTMLDetailsElement>(null)
  const trigger = useRef<HTMLElement>(null)
  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) menu.current?.removeAttribute('open')
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [])
  return <details ref={menu} className="group relative">
    <summary ref={trigger} aria-label="App navigation" className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 py-1.5 transition-colors hover:bg-[color:var(--surface-soft)] [&::-webkit-details-marker]:hidden">
      <Wordmark compact className="text-base" /><ChevronDown size={13} className="text-[color:var(--muted)] transition-transform group-open:rotate-180" aria-hidden />
    </summary>
    <nav className="absolute left-0 z-50 mt-2 max-h-[70dvh] w-56 overflow-y-auto rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-1.5 shadow-lg" aria-label="Sections">
      {LINKS.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => menu.current?.removeAttribute('open')} className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-[color:var(--muted)] transition-colors hover:bg-[color:var(--hover-surface)] hover:text-ink"><Icon size={16} aria-hidden />{label}</Link>)}
    </nav>
  </details>
}
