'use client'
import Link from 'next/link'
import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { ArrowUpRight, Check, HardDrive, SlidersHorizontal } from 'lucide-react'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { ResponsePreferencesControls } from '@/components/copilot/CopilotWorkspaceUi'
import { AppearanceSettings } from '@/lib/appIdentity/AppearanceSettings'
import { useResponsePreferences } from '@/lib/copilot/useResponsePreferences'
import { PACKS } from '@/lib/transcription/keytermPacks'
import { useKeytermPrefs } from '@/lib/transcription/useKeytermPrefs'
import { CandidateProfileSettings } from './CandidateProfileSettings'

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'answers', label: 'AI answers' },
  { id: 'audio', label: 'Audio' },
  { id: 'appearance', label: 'Appearance' },
] as const
type SettingsTab = (typeof TABS)[number]['id']
const TAB_EVENT = 'lt:settings-tab'
function readTab(): SettingsTab {
  return TABS.find((tab) => `#${tab.id}` === window.location.hash)?.id ?? 'profile'
}
function subscribeTab(notify: () => void) {
  window.addEventListener('hashchange', notify)
  window.addEventListener(TAB_EVENT, notify)
  return () => { window.removeEventListener('hashchange', notify); window.removeEventListener(TAB_EVENT, notify) }
}

function AnswerSettings() {
  const { preferences, setFormat, setTone, setFollowups } = useResponsePreferences()
  const [changed, setChanged] = useState(false)
  return <section aria-labelledby="settings-answers-heading" className="max-w-3xl">
    <h2 id="settings-answers-heading" className="text-lg font-semibold tracking-[-0.015em]">How answers read</h2>
    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[color:var(--muted)]">Set the amount of explanation, tone, and follow-up questions for your next AI answer.</p>
    <div className="mt-5 max-w-2xl rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-4 sm:p-5">
      <ResponsePreferencesControls compact preferences={preferences}
        setFormat={(format) => { setFormat(format); setChanged(true) }}
        setTone={(tone) => { setTone(tone); setChanged(true) }}
        setFollowups={(followups) => { setFollowups(followups); setChanged(true) }} />
    </div>
    <p role="status" className="mt-4 min-h-5 text-xs text-[color:var(--muted)]">{changed ? 'Applied to your next answer.' : 'These controls are also available in AI Copilot.'}</p>
    <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">Preferences are saved on this device when browser storage is available.</p>
  </section>
}

function AudioSettings() {
  const { enabledIds, toggle, keyterms } = useKeytermPrefs()
  const [changed, setChanged] = useState(false)
  return <section aria-labelledby="settings-audio-heading" className="max-w-3xl">
    <h2 id="settings-audio-heading" className="text-lg font-semibold tracking-[-0.015em]">Audio and recognition</h2>
    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-[color:var(--muted)]">Connect audio in a session. Choose vocabulary here to help the transcriber recognize technical terms.</p>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[color:var(--line)] bg-[color:var(--reader)] p-4 sm:p-5">
      <div><h3 className="text-sm font-semibold">Recording setup</h3><p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">Microphone and system audio connect from the recording screen.</p></div>
      <Link href="/record" className="btn-ghost min-h-11 gap-2 px-3 text-xs">Open audio setup<ArrowUpRight size={14} aria-hidden /></Link>
    </div>
    <div className="mt-7 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Vocabulary packs</h3><span className="text-xs tabular-nums text-[color:var(--muted)]">{keyterms.length} / 100 terms active</span></div>
    <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted)]">Packs apply when the next recording starts. Core tech is always included.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {PACKS.map((pack) => {
        const active = Boolean(pack.base || enabledIds.includes(pack.id))
        return <button key={pack.id} type="button" disabled={pack.base} aria-pressed={active} onClick={() => { toggle(pack.id); setChanged(true) }}
          className={`flex min-h-24 cursor-pointer items-start justify-between gap-3 rounded-xl border bg-[color:var(--reader)] p-4 text-left transition-colors hover:bg-[color:var(--surface-soft)] disabled:cursor-default ${active ? 'border-[color:var(--signal)]' : 'border-[color:var(--line)]'}`}>
          <span><span className="block text-sm font-medium">{pack.name}</span><span className="mt-1 block text-xs leading-relaxed text-[color:var(--muted)]">{pack.description}</span>{pack.base && <span className="mt-2 block text-[11px] font-medium text-[color:var(--signal)]">Always on</span>}</span>
          <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${active ? 'bg-[color:var(--signal)] text-white' : 'border border-[color:var(--line)]'}`}>{active && <Check size={12} />}</span>
        </button>
      })}
    </div>
    <p role="status" className="mt-4 min-h-5 text-xs text-[color:var(--muted)]">{changed ? 'Vocabulary updated for your next recording.' : 'Your choices are remembered on this device when browser storage is available.'}{keyterms.length >= 100 ? ' At the limit — turn off a pack to include more terms from another.' : ''}</p>
  </section>
}

export function SettingsWorkspace() {
  const active = useSyncExternalStore(subscribeTab, readTab, () => 'profile' as const)
  const tabButtons = useRef<Partial<Record<SettingsTab, HTMLButtonElement>>>({})

  function selectTab(tab: SettingsTab) {
    window.history.replaceState(window.history.state, '', `#${tab}`)
    window.dispatchEvent(new Event(TAB_EVENT))
  }

  function tabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    selectTab(TABS[next].id)
    tabButtons.current[TABS[next].id]?.focus()
  }

  return <WorkspaceShell active="settings">
    <main className="mx-auto w-full max-w-[1160px] px-4 pb-16 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-medium text-[color:var(--muted)]"><SlidersHorizontal size={14} aria-hidden /> Workspace preferences</p>
          <h1 className="text-2xl font-semibold tracking-[-0.035em] sm:text-3xl">Settings</h1>
          <p className="mt-2 text-sm text-[color:var(--muted)]">Make the assistant work with your experience and your way of thinking.</p>
        </div>
        <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 text-xs text-[color:var(--muted)]"><HardDrive size={14} aria-hidden /> Device preferences</span>
      </header>

      <div role="tablist" aria-label="Settings sections" aria-orientation="horizontal" className="mt-7 flex gap-1 overflow-x-auto border-b border-[color:var(--line)]">
        {TABS.map((tab, index) => <button key={tab.id} ref={(element) => { if (element) tabButtons.current[tab.id] = element }} type="button" role="tab" id={`settings-tab-${tab.id}`} aria-selected={active === tab.id} aria-controls={`settings-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => selectTab(tab.id)} onKeyDown={(event) => tabKey(event, index)}
          className={`min-h-12 shrink-0 cursor-pointer border-b-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--signal)] sm:px-5 ${active === tab.id ? 'border-[color:var(--signal)] text-[color:var(--signal)]' : 'border-transparent text-[color:var(--muted)] hover:bg-[color:var(--surface-soft)] hover:text-ink'}`}>{tab.label}</button>)}
      </div>

      <div className="pt-6 sm:pt-7">
        <div id="settings-panel-profile" role="tabpanel" aria-labelledby="settings-tab-profile" tabIndex={0} hidden={active !== 'profile'}><CandidateProfileSettings /></div>
        <div id="settings-panel-answers" role="tabpanel" aria-labelledby="settings-tab-answers" tabIndex={0} hidden={active !== 'answers'}><AnswerSettings /></div>
        <div id="settings-panel-audio" role="tabpanel" aria-labelledby="settings-tab-audio" tabIndex={0} hidden={active !== 'audio'}><AudioSettings /></div>
        <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" tabIndex={0} hidden={active !== 'appearance'} className="max-w-3xl [&>section]:mt-0 [&_h2]:font-[family-name:var(--font-body)] [&_h2]:text-lg [&_h2]:font-semibold"><AppearanceSettings /></div>
      </div>
    </main>
  </WorkspaceShell>
}
