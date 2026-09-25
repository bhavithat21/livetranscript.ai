'use client'

import Link from 'next/link'
import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { AudioLines, ChevronDown, Download, FileText, FlaskConical, GitBranch, GraduationCap, Menu, MessageSquareText, MonitorUp, Plus, Settings2, Sparkles } from 'lucide-react'
import { Wordmark } from './Wordmark'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import styles from './WorkspaceShell.module.css'

export type WorkspaceSection = 'interview' | 'copilot' | 'repository' | 'practice' | 'transcripts' | 'remote' | 'settings'
export type InterviewView = 'live' | 'mock' | 'feedback'

type Props = {
  active: WorkspaceSection
  children: ReactNode
  interviewView?: InterviewView
  onInterviewViewChange?: (view: InterviewView) => void
  onNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void
}

const INTERVIEW_LINKS = [
  { view: 'live', label: 'Live interview', icon: AudioLines },
  { view: 'mock', label: 'Mock Lab', icon: FlaskConical },
  { view: 'feedback', label: 'Feedback', icon: MessageSquareText },
] as const
const TOOL_LINKS = [
  { id: 'copilot', href: '/copilot', label: 'AI workspace', icon: Sparkles },
  { id: 'repository', href: '/interview/repository', label: 'Repository', icon: GitBranch },
  { id: 'practice', href: '/practice', label: 'Practice', icon: GraduationCap },
  { id: 'transcripts', href: '/dashboard', label: 'Transcripts', icon: FileText },
  { id: 'remote', href: '/remote', label: 'Remote assist', icon: MonitorUp },
] as const

/** One navigation owner for product routes. Capture lifetimes stay with each page. */
export function WorkspaceShell({ active, children, interviewView = 'live', onInterviewViewChange, onNavigate }: Props) {
  const mobileMenu = useRef<HTMLDetailsElement>(null)
  const mobileTrigger = useRef<HTMLElement>(null)

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !mobileMenu.current?.contains(event.target)) mobileMenu.current?.removeAttribute('open')
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && mobileMenu.current?.open) {
        mobileMenu.current.open = false
        mobileTrigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [])

  function navigate(event: MouseEvent<HTMLAnchorElement>, view?: InterviewView) {
    if (view && active === 'interview' && onInterviewViewChange && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      onInterviewViewChange(view)
      const fromMobileMenu = mobileMenu.current?.open && mobileMenu.current.contains(event.currentTarget)
      mobileMenu.current?.removeAttribute('open')
      if (fromMobileMenu) mobileTrigger.current?.focus()
      return
    }
    onNavigate?.(event)
    if (!event.defaultPrevented) mobileMenu.current?.removeAttribute('open')
  }

  function navigation(mobile: boolean) {
    return <nav aria-label={mobile ? 'Mobile workspace' : 'Workspace'} className={styles.navigation}>
      <p className={styles.groupLabel}>Interview</p>
      {INTERVIEW_LINKS.map(({ view, label, icon: Icon }) => <Link key={view} href={`/interview#${view}`} onClick={(event) => navigate(event, view)} aria-current={active === 'interview' && interviewView === view ? 'page' : undefined} className={styles.navLink}>
        <Icon size={17} strokeWidth={1.7} aria-hidden /><span>{label}</span>
        {active === 'interview' && interviewView === view && <span className={styles.selectedDot} aria-hidden />}
      </Link>)}
      <p className={styles.groupLabel}>Your tools</p>
      {TOOL_LINKS.map(({ id, href, label, icon: Icon }) => <Link key={id} href={href} onClick={(event) => navigate(event)} aria-current={active === id ? 'page' : undefined} className={styles.navLink}>
        <Icon size={17} strokeWidth={1.7} aria-hidden /><span>{label}</span>
      </Link>)}
      <div className={styles.navBottom}>
        <Link href="/settings" onClick={(event) => navigate(event)} aria-current={active === 'settings' ? 'page' : undefined} className={styles.navLink}><Settings2 size={17} strokeWidth={1.7} aria-hidden />Settings</Link>
        <Link href="/download" onClick={(event) => navigate(event)} className={styles.navLink}><Download size={17} strokeWidth={1.7} aria-hidden />Desktop app</Link>
      </div>
    </nav>
  }

  const currentLabel = active === 'interview' ? INTERVIEW_LINKS.find(item => item.view === interviewView)?.label : active === 'settings' ? 'Settings' : TOOL_LINKS.find(item => item.id === active)?.label

  return <div className={styles.shell}>
    <a href="#workspace-content" className={styles.skipLink}>Skip to workspace</a>
    <aside className={styles.sidebar}>
      <Link href="/" className={styles.brand} onClick={(event) => navigate(event)} aria-label="LiveTranscript home"><Wordmark className="text-[17px]" /></Link>
      <Link href="/record" onClick={(event) => navigate(event)} className={styles.newSession}><Plus size={17} aria-hidden />New transcript</Link>
      {navigation(false)}
      <div className={styles.sidebarFooter}><div><strong>Your workspace</strong><span>Make room for better answers.</span></div><ThemeToggle /></div>
    </aside>
    <header className={styles.mobileHeader}>
      <details ref={mobileMenu} className={styles.mobileMenu}>
        <summary ref={mobileTrigger} aria-label="Open workspace navigation" className={styles.mobileTrigger}><Menu size={19} aria-hidden /><Wordmark compact className="text-base" /><span className={styles.mobileCurrent}>{currentLabel}</span><ChevronDown size={15} aria-hidden /></summary>
        <div className={styles.mobileNavPanel}>{navigation(true)}<Link href="/record" className={styles.newSession} onClick={(event) => navigate(event)}><Plus size={17} aria-hidden />New transcript</Link><Link href="/" className={styles.mobileHome} onClick={(event) => navigate(event)}>Back to website</Link></div>
      </details>
      <ThemeToggle />
    </header>
    <div className={styles.content} id="workspace-content" tabIndex={-1}>{children}</div>
  </div>
}
