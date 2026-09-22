'use client'
import { useCallback, useEffect, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { createInterviewHistory } from '@/lib/interview/history'
import type { InterviewSession } from '@/lib/interview/session'
import { LiveInterview } from './LiveInterview'
import { MockInterview } from './MockInterview'
import { InterviewFeedback } from './InterviewFeedback'

const TABS = [
  { id: 'live', label: 'Live Interview' },
  { id: 'mock', label: 'Mock Interview' },
  { id: 'feedback', label: 'Interview Feedback' },
] as const
type Tab = (typeof TABS)[number]['id']

export function InterviewWorkspace({ ownerId }: { ownerId: string }) {
  const [tab, setTab] = useState<Tab>('live')
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
    store.add(session)
    setSelectedId(session.id)
    setTab('feedback')
    setNavigationError(null)
  }, [store])

  function guardNavigation(event: MouseEvent<HTMLDivElement>) {
    if (!active || !(event.target instanceof Element) || !event.target.closest('a[href]')) return
    event.preventDefault()
    setNavigationError('Finish the active interview before leaving this workspace. You can switch between its tabs without stopping capture.')
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    setTab(TABS[next].id)
    document.getElementById(`interview-tab-${TABS[next].id}`)?.focus()
  }

  return (
    <main className="mx-auto min-h-dvh max-w-6xl px-4 pb-16 pt-5 text-ink sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div onClickCapture={guardNavigation}><HomeMenu /></div>
        <div className="min-w-0"><h1 className="font-[family-name:var(--font-serif)] text-3xl sm:text-4xl">Interview workspace</h1><p className="mt-1 text-sm text-black/60">Practice. Capture. Review.</p></div>
      </header>
      <div role="tablist" aria-label="Interview modes" className="glass mb-5 flex gap-1 overflow-x-auto rounded-2xl p-1.5">
        {TABS.map((item, index) => <button key={item.id} id={`interview-tab-${item.id}`} role="tab" aria-selected={tab === item.id} aria-controls={`interview-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={(event) => tabKey(event, index)} onClick={() => setTab(item.id)} className={`min-h-11 shrink-0 flex-1 rounded-xl px-4 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--signal)] ${tab === item.id ? 'bg-[color:var(--signal)] text-white' : 'text-black/60 hover:bg-black/5'}`}>{item.label}</button>)}
      </div>
      {active && ((liveActive && tab !== 'live') || (mockActive && tab !== 'mock')) && <div role="status" className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/15 p-4 text-sm"><span>{liveActive ? 'Live interview remains active. Switching tabs does not stop audio capture.' : 'Your mock interview is in progress; its question and draft answer are preserved.'}</span><button className="btn-ghost" onClick={() => setTab(liveActive ? 'live' : 'mock')}>Return to active interview</button></div>}
      {navigationError && <p role="alert" className="mb-4 text-sm text-[color:var(--stop)]">{navigationError}</p>}
      {history.error && <p role="alert" className="mb-4 rounded-xl border border-black/15 p-4 text-sm">{history.error}</p>}
      {/* Keep each panel mounted: tab changes must not tear down a microphone or
          discard an answer. Only the copilot overlay hides when Live is not visible. */}
      <div id="interview-panel-live" role="tabpanel" aria-labelledby="interview-tab-live" hidden={tab !== 'live'}><LiveInterview visible={tab === 'live'} blocked={mockActive} onActivity={setLiveActive} onComplete={completed} /></div>
      <div id="interview-panel-mock" role="tabpanel" aria-labelledby="interview-tab-mock" hidden={tab !== 'mock'}><MockInterview blocked={liveActive} onActivity={setMockActive} onComplete={completed} /></div>
      <div id="interview-panel-feedback" role="tabpanel" aria-labelledby="interview-tab-feedback" hidden={tab !== 'feedback'}><InterviewFeedback sessions={history.sessions} selectedId={selectedId} onSelect={setSelectedId} store={store} /></div>
      <footer className="mt-6 text-xs leading-relaxed text-black/60">The latest 20 completed sessions and reports are saved in this browser for your signed-in account, not synced to other devices. Export important sessions before clearing browser data or exceeding that limit. Anyone with access to this browser profile may be able to read local storage. AI requests send the selected transcript or submitted answers to the server&apos;s configured provider.</footer>
    </main>
  )
}
