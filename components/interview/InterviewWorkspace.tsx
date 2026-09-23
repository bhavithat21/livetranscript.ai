'use client'
import { useCallback, useEffect, useState, useSyncExternalStore, type MouseEvent } from 'react'
import { Activity, ArrowLeft, Check, ShieldCheck } from 'lucide-react'
import { WorkspaceShell, type InterviewView } from '@/components/nav/WorkspaceShell'
import { createInterviewHistory } from '@/lib/interview/history'
import type { InterviewSession } from '@/lib/interview/session'
import { InterviewTuningProvider, useInterviewTuning } from '@/lib/interview/TuningContext'
import { LiveInterview } from './LiveInterview'
import { MockInterview } from './MockInterview'
import { InterviewFeedback } from './InterviewFeedback'
import styles from './Interview.module.css'

const VIEWS = {
  live: { label: 'Live interview', description: 'Stay with the conversation. Keep the context close.' },
  mock: { label: 'Mock Lab', description: 'Test an answer. Review the evidence. Improve your live profile.' },
  feedback: { label: 'Interview feedback', description: 'Every session is a chance to make the next one better.' },
} satisfies Record<InterviewView, { label: string; description: string }>

function currentView(): InterviewView {
  const value = window.location.hash.slice(1)
  return value === 'mock' || value === 'feedback' ? value : 'live'
}
function subscribeView(listener: () => void) {
  window.addEventListener('hashchange', listener)
  window.addEventListener('popstate', listener)
  return () => { window.removeEventListener('hashchange', listener); window.removeEventListener('popstate', listener) }
}
function setView(view: InterviewView) {
  if (window.location.hash === `#${view}`) return
  window.history.pushState(window.history.state, '', `#${view}`)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

function ProfileStatus() {
  const { state, error } = useInterviewTuning()
  return <div className={styles.profileStatus}>
    <span><Check size={13} aria-hidden />Live profile <strong>v{state.active.revision}</strong></span>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>
}

function Workspace({ ownerId }: { ownerId: string }) {
  const view = useSyncExternalStore(subscribeView, currentView, () => 'live' as const)
  const [liveActive, setLiveActive] = useState(false)
  const [mockActive, setMockActive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [navigationError, setNavigationError] = useState<string | null>(null)
  const [store] = useState(() => createInterviewHistory(ownerId, () => typeof window === 'undefined' ? undefined : window.localStorage))
  const history = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  const active = liveActive || mockActive

  useEffect(() => {
    if (!active) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', beforeUnload)
    return () => window.removeEventListener('beforeunload', beforeUnload)
  }, [active])

  const completed = useCallback((session: InterviewSession) => {
    store.add(session); setSelectedId(session.id); setView('feedback'); setNavigationError(null)
  }, [store])

  function guardNavigation(event: MouseEvent<HTMLAnchorElement>) {
    if (!active) return
    event.preventDefault()
    setNavigationError('Finish the active interview before leaving this workspace. Switching between Interview views is safe.')
  }

  const current = VIEWS[view]
  return <WorkspaceShell active="interview" interviewView={view} onInterviewViewChange={setView} onNavigate={guardNavigation}>
    <main className={styles.workspace}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>Your interview workspace</p><h1>{current.label}</h1><p className={styles.description}>{current.description}</p></div>
        <div className={styles.headerMeta}><ProfileStatus />{active && <span className={styles.activeLabel}><Activity size={13} aria-hidden />Session active</span>}</div>
      </header>
      {active && ((liveActive && view !== 'live') || (mockActive && view !== 'mock')) && <div role="status" className={styles.activityNotice}><span>{liveActive ? 'Live interview remains active. Audio capture continues while you review another view.' : 'Mock Lab is still running.'}</span><button type="button" onClick={() => setView(liveActive ? 'live' : 'mock')}><ArrowLeft size={14} aria-hidden />Return to session</button></div>}
      {navigationError && <p role="alert" className={styles.errorBanner}>{navigationError}</p>}
      {history.error && <p role="alert" className={styles.errorBanner}>{history.error}</p>}
      <section id="interview-panel-live" aria-label="Live Interview" hidden={view !== 'live'}><LiveInterview visible={view === 'live'} blocked={mockActive} onActivity={setLiveActive} onComplete={completed} /></section>
      <section id="interview-panel-mock" aria-label="Mock Lab" hidden={view !== 'mock'}><MockInterview visible={view === 'mock'} blocked={liveActive} onActivity={setMockActive} onComplete={completed} /></section>
      <section id="interview-panel-feedback" aria-label="Interview Feedback" hidden={view !== 'feedback'}><InterviewFeedback sessions={history.sessions} selectedId={selectedId} onSelect={setSelectedId} store={store} /></section>
      <footer className={styles.workspaceFooter}><ShieldCheck size={14} aria-hidden /><span>Session history stays in this browser, separated by account.</span></footer>
    </main>
  </WorkspaceShell>
}

export function InterviewWorkspace({ ownerId }: { ownerId: string }) {
  return <InterviewTuningProvider ownerId={ownerId}><Workspace ownerId={ownerId} /></InterviewTuningProvider>
}
