'use client'
import Link from 'next/link'
import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { ArrowUpRight, Check, FileText, GraduationCap, MonitorUp, Radio, Settings2, Sparkles } from 'lucide-react'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
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

const NAV_LINKS = [
  { href: '/copilot', label: 'AI Copilot', icon: Sparkles },
  { href: '/interview', label: 'Interview', icon: Radio },
  { href: '/practice', label: 'Practice', icon: GraduationCap },
  { href: '/dashboard', label: 'Transcripts', icon: FileText },
  { href: '/remote', label: 'Remote Assist', icon: MonitorUp },
] as const

function AnswerSettings() {
  const { preferences, setFormat, setTone, setFollowups } = useResponsePreferences()
  const [changed, setChanged] = useState(false)
  return <section aria-labelledby="settings-answers-heading">
    <h2 id="settings-answers-heading" className="text-lg font-semibold tracking-[-0.015em]">How answers read</h2>
    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-black/55">Set the amount of explanation, tone, and follow-up questions for your next AI answer.</p>
    <div className="mt-5 max-w-2xl rounded-xl border border-black/10 bg-white/60 p-4 sm:p-5">
      <ResponsePreferencesControls compact preferences={preferences}
        setFormat={(format) => { setFormat(format); setChanged(true) }}
        setTone={(tone) => { setTone(tone); setChanged(true) }}
        setFollowups={(followups) => { setFollowups(followups); setChanged(true) }} />
    </div>
    <p role="status" className="mt-4 min-h-5 text-xs text-black/55">{changed ? 'Applied to your next answer.' : 'These controls are also available in AI Copilot.'}</p>
    <p className="mt-1 text-xs leading-relaxed text-black/45">Preferences are saved on this device when browser storage is available.</p>
  </section>
}

function AudioSettings() {
  const { enabledIds, toggle, keyterms } = useKeytermPrefs()
  const [changed, setChanged] = useState(false)
  return <section aria-labelledby="settings-audio-heading">
    <h2 id="settings-audio-heading" className="text-lg font-semibold tracking-[-0.015em]">Audio and recognition</h2>
    <p className="mt-1 max-w-2xl text-sm leading-relaxed text-black/55">Connect audio in a session. Choose vocabulary here to help the transcriber recognize technical terms.</p>
    <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-black/10 bg-white/60 p-4 sm:p-5">
      <div><h3 className="text-sm font-semibold">Recording setup</h3><p className="mt-1 text-xs leading-relaxed text-black/55">Microphone and system audio connect from the recording screen.</p></div>
      <Link href="/record" className="btn-ghost min-h-11 gap-2 px-3 text-xs">Open audio setup<ArrowUpRight size={14} aria-hidden /></Link>
    </div>
    <div className="mt-7 flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Vocabulary packs</h3><span className="text-xs tabular-nums text-black/50">{keyterms.length} / 100 terms active</span></div>
    <p className="mt-1 text-xs leading-relaxed text-black/55">Packs apply when the next recording starts. Core tech is always included.</p>
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {PACKS.map((pack) => {
        const active = Boolean(pack.base || enabledIds.includes(pack.id))
        return <button key={pack.id} type="button" disabled={pack.base} aria-pressed={active} onClick={() => { toggle(pack.id); setChanged(true) }}
          className={`flex min-h-24 cursor-pointer items-start justify-between gap-3 rounded-xl border bg-white/60 p-4 text-left transition-colors hover:bg-black/[0.025] disabled:cursor-default ${active ? 'border-emerald-700/40' : 'border-black/10'}`}>
          <span><span className="block text-sm font-medium">{pack.name}</span><span className="mt-1 block text-xs leading-relaxed text-black/55">{pack.description}</span>{pack.base && <span className="mt-2 block text-[11px] font-medium text-[color:var(--signal)]">Always on</span>}</span>
          <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${active ? 'bg-[color:var(--signal)] text-white' : 'border border-black/15'}`}>{active && <Check size={12} />}</span>
        </button>
      })}
    </div>
    <p role="status" className="mt-4 min-h-5 text-xs text-black/55">{changed ? 'Vocabulary updated for your next recording.' : 'Your choices are remembered on this device when browser storage is available.'}{keyterms.length >= 100 ? ' At the limit — turn off a pack to include more terms from another.' : ''}</p>
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

  return <main className="min-h-dvh text-ink">
    <div className="mx-auto grid min-h-dvh max-w-[1480px] lg:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="hidden border-r border-black/[0.07] bg-black/[0.018] px-3 py-4 lg:flex lg:flex-col">
        <div className="px-2"><HomeMenu /></div>
        <p className="mt-8 px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-black/35">Workspace</p>
        <nav aria-label="Settings workspace navigation" className="mt-2 space-y-1">
          {NAV_LINKS.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className="flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-black/50 transition-colors hover:bg-black/[0.035] hover:text-ink"><Icon size={16} aria-hidden />{label}</Link>)}
          <Link href="/settings" aria-current="page" className="flex min-h-11 items-center gap-2.5 rounded-lg bg-black/[0.055] px-2.5 py-2 text-sm font-medium text-ink"><Settings2 size={16} aria-hidden />Settings</Link>
        </nav>
        <p className="mt-auto px-2 pt-8 text-xs leading-relaxed text-black/45">Settings here apply to this browser or desktop app.</p>
      </aside>

      <div className="min-w-0 px-4 pb-20 pt-4 sm:px-6 lg:px-8 lg:pt-6 xl:px-10">
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-5 lg:hidden"><HomeMenu /></div>
            <h1 className="text-xl font-semibold tracking-[-0.02em] sm:text-2xl">Settings</h1>
            <p className="mt-1 text-sm text-black/45">Your context, answers, audio, and app appearance.</p>
          </div>
          <ThemeToggle />
        </header>

        <div role="tablist" aria-label="Settings sections" aria-orientation="horizontal" className="mt-6 flex gap-1 overflow-x-auto border-b border-black/10">
          {TABS.map((tab, index) => <button key={tab.id} ref={(element) => { if (element) tabButtons.current[tab.id] = element }} type="button" role="tab" id={`settings-tab-${tab.id}`} aria-selected={active === tab.id} aria-controls={`settings-panel-${tab.id}`} tabIndex={active === tab.id ? 0 : -1} onClick={() => selectTab(tab.id)} onKeyDown={(event) => tabKey(event, index)}
            className={`min-h-12 shrink-0 cursor-pointer border-b-2 px-3 py-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--signal)] sm:px-4 ${active === tab.id ? 'border-[color:var(--signal)] text-[color:var(--signal)]' : 'border-transparent text-black/50 hover:bg-black/[0.025] hover:text-ink'}`}>{tab.label}</button>)}
        </div>

        <div className="max-w-4xl pt-6">
          <div id="settings-panel-profile" role="tabpanel" aria-labelledby="settings-tab-profile" tabIndex={0} hidden={active !== 'profile'}><CandidateProfileSettings /></div>
          <div id="settings-panel-answers" role="tabpanel" aria-labelledby="settings-tab-answers" tabIndex={0} hidden={active !== 'answers'}><AnswerSettings /></div>
          <div id="settings-panel-audio" role="tabpanel" aria-labelledby="settings-tab-audio" tabIndex={0} hidden={active !== 'audio'}><AudioSettings /></div>
          <div id="settings-panel-appearance" role="tabpanel" aria-labelledby="settings-tab-appearance" tabIndex={0} hidden={active !== 'appearance'} className="[&>section]:mt-0 [&_h2]:font-[family-name:var(--font-body)] [&_h2]:text-lg [&_h2]:font-semibold"><AppearanceSettings /></div>
        </div>
      </div>
    </div>
  </main>
}
