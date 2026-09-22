'use client'
import { useCallback, useEffect, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react'
import { Activity, FlaskConical, MessageSquareText, Radio, RotateCcw } from 'lucide-react'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { createInterviewHistory } from '@/lib/interview/history'
import type { InterviewSession } from '@/lib/interview/session'
import { InterviewTuningProvider, useInterviewTuning } from '@/lib/interview/TuningContext'
import { LiveInterview } from './LiveInterview'
import { MockInterview } from './MockInterview'
import { InterviewFeedback } from './InterviewFeedback'

const TABS = [
  { id: 'live', label: 'Live Interview', short: 'Live', icon: Radio, description: 'Run the production interview assistant' },
  { id: 'mock', label: 'Mock Interview', short: 'Mock Lab', icon: FlaskConical, description: 'Test and tune the live system' },
  { id: 'feedback', label: 'Interview Feedback', short: 'Feedback', icon: MessageSquareText, description: 'Review sessions and system tests' },
] as const
type Tab = (typeof TABS)[number]['id']

function ProfileStatus({ compact = false }: { compact?: boolean }) {
  const { state, error } = useInterviewTuning()
  return <div className={compact ? 'text-xs text-black/45' : 'rounded-xl border border-black/[0.07] bg-black/[0.025] px-3 py-2.5 text-xs text-black/55'}>
    <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-emerald-600" /><span>Live profile v{state.active.revision}</span></div>
    {error && <p role="alert" className="mt-1 text-[color:var(--stop)]">{error}</p>}
  </div>
}

function Workspace({ ownerId }: { ownerId: string }) {
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
    store.add(session); setSelectedId(session.id); setTab('feedback'); setNavigationError(null)
  }, [store])

  function guardNavigation(event: MouseEvent<HTMLDivElement>) {
    if (!active || !(event.target instanceof Element) || !event.target.closest('a[href]')) return
    event.preventDefault()
    setNavigationError('Finish the active session before leaving Interview. Switching between Interview views is safe.')
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault(); setTab(TABS[next].id)
    document.getElementById(`interview-tab-${TABS[next].id}`)?.focus()
  }

  const current = TABS.find((item) => item.id === tab) ?? TABS[0]
  return <main className="min-h-dvh text-ink">
    <div className="mx-auto grid min-h-dvh max-w-[1480px] lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden border-r border-black/[0.07] bg-black/[0.018] px-3 py-4 lg:flex lg:flex-col" onClickCapture={guardNavigation}>
        <div className="px-2"><HomeMenu /></div>
        <div className="mt-8 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-black/35">Interview</div>
        <div role="tablist" aria-label="Interview modes" aria-orientation="vertical" className="mt-2 space-y-1">
          {TABS.map((item, index) => {
            const Icon = item.icon
            return <button key={item.id} id={`interview-tab-${item.id}`} role="tab" aria-label={item.label} aria-selected={tab === item.id} aria-controls={`interview-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={(event) => tabKey(event, index)} onClick={() => setTab(item.id)} className={`group w-full rounded-lg px-2.5 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--signal)] ${tab === item.id ? 'bg-black/[0.055] text-ink' : 'text-black/50 hover:bg-black/[0.035] hover:text-ink'}`}>
              <span className="flex items-center gap-2.5 text-sm font-medium"><Icon size={16} strokeWidth={1.8} />{item.short}{(item.id === 'live' && liveActive) || (item.id === 'mock' && mockActive) ? <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-600" /> : null}</span>
            </button>
          })}
        </div>
        <div className="mt-auto space-y-3 px-2"><ProfileStatus /><p className="text-[11px] leading-relaxed text-black/35">Mock Lab changes Live only after a reviewed test is explicitly promoted.</p></div>
      </aside>

      <section className="min-w-0 px-4 pb-20 pt-4 sm:px-6 lg:px-9 lg:pb-12 lg:pt-7">
        <header className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="lg:hidden" onClickCapture={guardNavigation}><HomeMenu /></div>
            <div className="mt-5 lg:mt-0"><h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">{current.short}</h1><p className="mt-1 text-sm text-black/45">{current.description}</p></div>
          </div>
          <div className="hidden items-center gap-2 lg:flex"><ProfileStatus compact />{active && <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-800"><Activity size={13} />Active</span>}</div>
        </header>

        <div role="tablist" aria-label="Interview modes" className="mb-5 grid grid-cols-3 rounded-xl bg-black/[0.035] p-1 lg:hidden">
          {TABS.map((item, index) => <button key={item.id} role="tab" aria-label={item.label} aria-selected={tab === item.id} onKeyDown={(event) => tabKey(event, index)} onClick={() => setTab(item.id)} className={`min-h-10 rounded-lg px-2 text-sm font-medium transition-colors ${tab === item.id ? 'bg-white text-ink shadow-sm' : 'text-black/45'}`}>{item.short}</button>)}
        </div>

        {active && ((liveActive && tab !== 'live') || (mockActive && tab !== 'mock')) && <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-700/15 bg-emerald-50/50 px-4 py-3 text-sm"><span>{liveActive ? 'Live Interview is still listening.' : 'Mock Lab is still running.'}</span><button className="inline-flex items-center gap-1.5 font-medium text-emerald-800" onClick={() => setTab(liveActive ? 'live' : 'mock')}><RotateCcw size={14} />Return</button></div>}
        {navigationError && <p role="alert" className="mb-4 text-sm text-[color:var(--stop)]">{navigationError}</p>}
        {history.error && <p role="alert" className="mb-4 rounded-xl border border-black/10 p-4 text-sm">{history.error}</p>}

        <div id="interview-panel-live" role="tabpanel" aria-labelledby="interview-tab-live" hidden={tab !== 'live'}><LiveInterview visible={tab === 'live'} blocked={mockActive} onActivity={setLiveActive} onComplete={completed} /></div>
        <div id="interview-panel-mock" role="tabpanel" aria-labelledby="interview-tab-mock" hidden={tab !== 'mock'}><MockInterview visible={tab === 'mock'} blocked={liveActive} onActivity={setMockActive} onComplete={completed} /></div>
        <div id="interview-panel-feedback" role="tabpanel" aria-labelledby="interview-tab-feedback" hidden={tab !== 'feedback'}><InterviewFeedback sessions={history.sessions} selectedId={selectedId} onSelect={setSelectedId} store={store} /></div>
      </section>
    </div>
  </main>
}

export function InterviewWorkspace({ ownerId }: { ownerId: string }) {
  return <InterviewTuningProvider ownerId={ownerId}><Workspace ownerId={ownerId} /></InterviewTuningProvider>
}
