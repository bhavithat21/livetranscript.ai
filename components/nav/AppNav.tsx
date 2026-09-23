'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowRight, Menu } from 'lucide-react'
import { Show, UserButton } from '@clerk/nextjs'
import { Wordmark } from './Wordmark'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import styles from '@/components/site/Site.module.css'

// Product routes own their workspace navigation. Public pages share this shell.
const HIDDEN_PREFIXES = ['/dashboard', '/record', '/copilot', '/interview', '/practice', '/room', '/remote', '/s', '/session', '/settings', '/sign-in', '/sign-up', '/shadow-demo']
const LINKS = [
  { href: '/#workflows', label: 'Product' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/download', label: 'Download' },
]

export function AppNav({ clerkConfigured }: { clerkConfigured: boolean }) {
  const pathname = usePathname()
  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return null

  return (
    <header className={styles.siteHeader}>
      <nav aria-label="Main" className={`${styles.container} ${styles.nav}`}>
        <Link href="/" aria-label="LiveTranscript home" className={styles.brand}><Wordmark /></Link>
        <div className={styles.navLinks}>
          {LINKS.map(({ href, label }) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined} className={styles.navLink}>{label}</Link>)}
        </div>
        <div className={styles.navActions}>
          <ThemeToggle />
          {clerkConfigured && <div className={styles.desktopAuth}>
            <Show when="signed-out"><Link href="/sign-in" className={styles.navLink}>Sign in</Link></Show>
            <Show when="signed-in"><UserButton /></Show>
          </div>}
          <Link href="/interview" className={styles.primary}>Open workspace<ArrowRight size={14} aria-hidden="true" /></Link>
          <details key={pathname} className={styles.mobileMenu} onKeyDown={(event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.currentTarget.open = false
            event.currentTarget.querySelector('summary')?.focus()
          }}>
            <summary aria-label="Open navigation"><Menu size={19} aria-hidden="true" /></summary>
            <nav className={styles.mobileLinks} aria-label="Mobile navigation" onClick={(event) => {
              if (!(event.target instanceof Element) || !event.target.closest('a[href]')) return
              const menu = event.currentTarget.closest('details')
              if (menu) menu.open = false
            }}>
              {LINKS.map(({ href, label }) => <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</Link>)}
              <Link href="/interview">Interview workspace</Link>
              <Link href="/copilot">AI workspace</Link>
              <Link href="/practice">Practice</Link>
              {clerkConfigured && <>
                <Show when="signed-out"><Link href="/sign-in">Sign in</Link></Show>
                <Show when="signed-in"><div className="flex items-center gap-3 p-3"><UserButton /><span className="text-sm">Your account</span></div></Show>
              </>}
            </nav>
          </details>
        </div>
      </nav>
    </header>
  )
}
