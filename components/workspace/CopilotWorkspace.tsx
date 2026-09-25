'use client'

import { LiveScrollArea } from '@/components/transcript/LiveScrollArea'
import { memo, useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, FileCode2, Mic, Monitor, Shield, Sparkles, Square, X } from 'lucide-react'
import { WorkspaceShell } from '@/components/nav/WorkspaceShell'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import { MODE_ORDER, type CopilotMode } from '@/lib/copilot/modes'
import { useCopilotCapture } from '@/lib/copilot/useCopilotCapture'

const WorkspacePanel = memo(CopilotPanel)

export function CopilotWorkspace({ initialMode = 'general' }: { initialMode?: CopilotMode }) {
  const capture = useCopilotCapture()
  const [activeMode, setActiveMode] = useState<CopilotMode>(initialMode)
  const lastMode = useRef(initialMode)
  const modeChanged = useCallback((mode: CopilotMode) => {
    if (!MODE_ORDER.includes(mode)) return
    setActiveMode(mode)
    if (lastMode.current === mode) return
    lastMode.current = mode
    // Keep the focus link accurate without navigating/remounting active capture.
    const url = new URL(window.location.href)
    if (mode === 'general') url.searchParams.delete('mode')
    else url.searchParams.set('mode', mode)
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])
  const [source, setSource] = useState<'mic' | 'system'>('mic')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const active = capture.status === 'starting' || capture.status === 'listening'
  const wordCount = capture.transcript.trim() ? capture.transcript.trim().split(/\s+/).length : 0

  return (
    <WorkspaceShell active={activeMode === 'repoInterview' ? 'repository' : 'copilot'}>
    <main className="ai-workspace flex min-h-dvh flex-col text-ink">
      <header className="ai-workspace-header flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[color:var(--line)] px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--signal)]/10 text-[color:var(--signal)]">{activeMode === 'repoInterview' ? <FileCode2 size={21} aria-hidden /> : <Sparkles size={21} aria-hidden />}</span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{activeMode === 'repoInterview' ? 'Repository' : 'AI workspace'}</h1>
            <p className="mt-0.5 text-xs text-[color:var(--muted)]">{activeMode === 'repoInterview' ? 'Understand files, trace behavior, and plan your next change.' : 'A dedicated space for questions, code, and deeper understanding.'}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-expanded={privacyOpen} aria-controls="copilot-privacy" onClick={() => setPrivacyOpen((open) => !open)} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-xs text-[color:var(--muted)] hover:bg-[color:var(--paper)]">
            <Shield size={15} aria-hidden /> <span>Privacy</span>
          </button>
        </div>
      </header>

      {privacyOpen && (
        <section id="copilot-privacy" aria-label="Privacy and desktop controls" className="ai-workspace-notice shrink-0 border-b border-[color:var(--line)] px-4 py-3 text-sm sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-3xl space-y-1.5">
              <p className="font-medium">Know what is shared.</p>
              <p className="text-[color:var(--muted)]">Audio and screen capture start only when you turn them on. Selected audio, screenshots and context are sent to the configured AI services when used. This workspace is excluded from product analytics and session replay.</p>
              <p className="text-[color:var(--muted)]">Browser content can appear in screen shares. Desktop capture protection depends on your operating system and the capture app; it does not hide the process or guarantee undetectability. Focus mode changes the reading appearance only.</p>
              <div className="flex flex-wrap gap-4 pt-1">
                <Link href="/settings#appearance" className="font-medium text-[color:var(--signal)] underline underline-offset-4">Change app name and icon</Link>
                <Link href="/download" className="font-medium text-[color:var(--signal)] underline underline-offset-4">Desktop app</Link>
              </div>
            </div>
            <button type="button" aria-label="Close privacy details" onClick={() => setPrivacyOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-[color:var(--paper)]"><X size={18} /></button>
          </div>
        </section>
      )}

      <section aria-label="Optional audio context" className="ai-workspace-audio shrink-0 border-b border-[color:var(--line)] px-4 py-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="mr-auto min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold"><span className={`h-1.5 w-1.5 rounded-full ${capture.status === 'listening' ? 'bg-emerald-500' : 'bg-[color:var(--muted)]/40'}`} aria-hidden />{active ? 'Audio context' : 'Optional audio'}</p>
            <p role="status" className="mt-0.5 text-xs text-[color:var(--muted)]">
              {capture.status === 'starting' ? 'Connecting audio… you can cancel at any time.' : capture.status === 'listening' ? `Listening${capture.engine ? ` · ${capture.engine}` : ''} · ${wordCount} words` : capture.transcript ? 'Audio stopped · captured context is still available.' : 'Type a question to begin. No meeting needed.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-[color:var(--line)] px-3 text-sm">
              {source === 'mic' ? <Mic size={15} aria-hidden /> : <Monitor size={15} aria-hidden />}
              <span className="sr-only">Audio source</span>
              <select value={source} disabled={active} onChange={(event) => setSource(event.target.value as 'mic' | 'system')} className="min-w-0 bg-transparent py-2 text-xs disabled:opacity-50">
                <option value="mic">Microphone</option>
                <option value="system">System audio</option>
              </select>
            </label>
            <button type="button" onClick={() => active ? capture.stop() : void capture.start(source)} className={`${active ? 'btn-stop' : 'btn-ghost'} inline-flex min-h-11 items-center gap-2 px-3 text-sm`}>
              {active ? <Square size={14} aria-hidden /> : <Mic size={15} aria-hidden />}
              {capture.status === 'starting' ? 'Cancel' : active ? 'Stop listening' : 'Start listening'}
            </button>
          </div>
          <button type="button" onClick={() => setTranscriptOpen((open) => !open)} aria-expanded={transcriptOpen} aria-controls="copilot-live-context" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm text-[color:var(--muted)] hover:bg-[color:var(--paper)]">
            Context{wordCount ? ` (${wordCount})` : ''} <ChevronDown size={14} className={transcriptOpen ? 'rotate-180' : ''} aria-hidden />
          </button>
        </div>
        {capture.truncated && <p role="status" className="mt-2 text-xs text-[color:var(--muted)]">Context limit reached. Only the most recent audio context is retained.</p>}
        {capture.error && <p role="alert" className="mt-2 text-sm text-[color:var(--stop)]">{capture.error}</p>}
        {source === 'system' && !active && <p className="mt-1 text-xs text-[color:var(--muted)]">In a browser, select a supported tab or display and enable its audio. The desktop app can use native system audio.</p>}
      </section>

      {transcriptOpen && (
        <section id="copilot-live-context" aria-label="Captured audio context" className="ai-workspace-notice shrink-0 border-b border-[color:var(--line)] px-4 py-3 sm:px-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-[color:var(--muted)]">Live context · kept in this tab</p>
            <button type="button" onClick={capture.clear} disabled={active || !capture.transcript} className="min-h-9 rounded-lg px-2 text-xs text-[color:var(--muted)] hover:bg-[color:var(--paper)] disabled:opacity-40">Clear audio context</button>
          </div>
          <LiveScrollArea updateKey={capture.segments ?? capture.transcript} enabled={active} className="max-h-40 whitespace-pre-wrap text-sm leading-relaxed" label="Audio transcript">
            {capture.segments?.map((segment) => segment.text).join(' ') || capture.transcript || 'Questions you hear will appear here after you start listening. You can also type directly into the copilot below.'}
          </LiveScrollArea>
        </section>
      )}

      <div className="ai-workspace-body min-h-0 flex-1 p-3 sm:p-4">
        <WorkspacePanel initialMode={initialMode} onModeChange={modeChanged} variant="workspace" getTranscript={capture.getTranscript} />
      </div>
    </main>
    </WorkspaceShell>
  )
}
