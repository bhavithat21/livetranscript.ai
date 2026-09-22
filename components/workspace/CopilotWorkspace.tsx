'use client'

import { memo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, Mic, Monitor, Shield, Square, X } from 'lucide-react'
import { HomeMenu } from '@/components/nav/HomeMenu'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { CopilotPanel } from '@/components/copilot/CopilotPanel'
import type { CopilotMode } from '@/lib/copilot/modes'
import { useCopilotCapture } from '@/lib/copilot/useCopilotCapture'

const WorkspacePanel = memo(CopilotPanel)

export function CopilotWorkspace({ initialMode = 'general' }: { initialMode?: CopilotMode }) {
  const capture = useCopilotCapture()
  const [source, setSource] = useState<'mic' | 'system'>('mic')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [privacyOpen, setPrivacyOpen] = useState(false)
  const active = capture.status === 'starting' || capture.status === 'listening'
  const wordCount = capture.transcript.trim() ? capture.transcript.trim().split(/\s+/).length : 0

  return (
    <main className="ai-workspace flex min-h-dvh flex-col text-ink">
      <header className="ai-workspace-header flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-black/10 px-4 py-3 sm:px-6">
        <HomeMenu />
        <nav aria-label="Workspace" className="flex min-w-0 items-center gap-1 text-sm">
          <Link href="/copilot" aria-current="page" className="inline-flex min-h-11 items-center rounded-xl bg-ink px-3 font-medium text-white">AI Copilot</Link>
          <Link href="/record" className="inline-flex min-h-11 items-center rounded-xl px-3 text-black/60 hover:bg-black/5">Transcript</Link>
          <Link href="/remote" className="inline-flex min-h-11 items-center rounded-xl px-3 text-black/60 hover:bg-black/5">Remote</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" aria-expanded={privacyOpen} aria-controls="copilot-privacy" onClick={() => setPrivacyOpen((open) => !open)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-black/60 hover:bg-black/5">
            <Shield size={15} aria-hidden /> <span>Privacy</span>
          </button>
          <ThemeToggle />
        </div>
      </header>

      {privacyOpen && (
        <section id="copilot-privacy" aria-label="Privacy and desktop controls" className="ai-workspace-notice shrink-0 border-b border-black/10 px-4 py-3 text-sm sm:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="max-w-3xl space-y-1.5">
              <p className="font-medium">Know what is shared.</p>
              <p className="text-black/65">Audio and screen capture start only when you turn them on. Selected audio, screenshots and context are sent to the configured AI services when used. This workspace is excluded from product analytics and session replay.</p>
              <p className="text-black/65">Browser content can appear in screen shares. Desktop capture protection depends on your operating system and the capture app; it does not hide the process or guarantee undetectability. Focus mode changes the reading appearance only.</p>
              <div className="flex flex-wrap gap-4 pt-1">
                <Link href="/settings#appearance" className="font-medium text-[color:var(--signal)] underline underline-offset-4">Change app name and icon</Link>
                <Link href="/download" className="font-medium text-[color:var(--signal)] underline underline-offset-4">Desktop app</Link>
              </div>
            </div>
            <button type="button" aria-label="Close privacy details" onClick={() => setPrivacyOpen(false)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-black/5"><X size={18} /></button>
          </div>
        </section>
      )}

      <section aria-label="Optional audio context" className="ai-workspace-audio shrink-0 border-b border-black/10 px-4 py-2 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="mr-auto min-w-0">
            <h1 className="font-[family-name:var(--font-serif)] text-xl font-medium">Your thinking space</h1>
            <p role="status" className="mt-0.5 text-xs text-black/55">
              {capture.status === 'starting' ? 'Connecting audio… you can cancel at any time.' : capture.status === 'listening' ? `Listening${capture.engine ? ` · ${capture.engine}` : ''} · ${wordCount} words` : capture.transcript ? 'Audio stopped · captured context is still available.' : 'Type a question to begin. No meeting needed.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex min-h-11 items-center gap-2 rounded-xl border border-black/15 px-3 text-sm">
              {source === 'mic' ? <Mic size={15} aria-hidden /> : <Monitor size={15} aria-hidden />}
              <span className="sr-only">Audio source</span>
              <select value={source} disabled={active} onChange={(event) => setSource(event.target.value as 'mic' | 'system')} className="min-w-0 bg-transparent py-2 outline-none disabled:opacity-50">
                <option value="mic">Microphone</option>
                <option value="system">System audio</option>
              </select>
            </label>
            <button type="button" onClick={() => active ? capture.stop() : void capture.start(source)} className={`${active ? 'btn-stop' : 'btn-ghost'} inline-flex min-h-11 items-center gap-2 px-3 text-sm`}>
              {active ? <Square size={14} aria-hidden /> : <Mic size={15} aria-hidden />}
              {capture.status === 'starting' ? 'Cancel' : active ? 'Stop listening' : 'Start listening'}
            </button>
          </div>
          <button type="button" onClick={() => setTranscriptOpen((open) => !open)} aria-expanded={transcriptOpen} aria-controls="copilot-live-context" className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm text-black/60 hover:bg-black/5">
            Context{wordCount ? ` (${wordCount})` : ''} <ChevronDown size={14} className={transcriptOpen ? 'rotate-180' : ''} aria-hidden />
          </button>
        </div>
        {capture.truncated && <p role="status" className="mt-2 text-xs text-black/55">Context limit reached. Only the most recent audio context is retained.</p>}
        {capture.error && <p role="alert" className="mt-2 text-sm text-[color:var(--stop)]">{capture.error}</p>}
        {source === 'system' && !active && <p className="mt-1 text-xs text-black/55">In a browser, select a supported tab or display and enable its audio. The desktop app can use native system audio.</p>}
      </section>

      {transcriptOpen && (
        <section id="copilot-live-context" aria-label="Captured audio context" className="ai-workspace-notice shrink-0 border-b border-black/10 px-4 py-3 sm:px-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-black/60">Live context · kept in this tab</p>
            <button type="button" onClick={capture.clear} disabled={active || !capture.transcript} className="min-h-9 rounded-lg px-2 text-xs text-black/60 hover:bg-black/5 disabled:opacity-40">Clear audio context</button>
          </div>
          <div className="max-h-40 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed" tabIndex={0} aria-label="Audio transcript">
            {capture.segments?.map((segment) => segment.text).join(' ') || capture.transcript || 'Questions you hear will appear here after you start listening. You can also type directly into the copilot below.'}
          </div>
        </section>
      )}

      <div className="ai-workspace-body min-h-0 flex-1">
        <WorkspacePanel initialMode={initialMode} variant="workspace" getTranscript={capture.getTranscript} />
      </div>
    </main>
  )
}
