'use client'

import { ArrowUpRight, Code2, Compass, FolderCode, MessagesSquare, Network, type LucideIcon } from 'lucide-react'
import { MODE_ORDER, MODE_PROFILES, type CopilotMode } from '@/lib/copilot/modes'
import type { AnswerPreferences } from '@/lib/copilot/answerPreferences'

const WORKSPACE_MODES: Record<CopilotMode, { icon: LucideIcon; description: string; title: string; prompts: string[] }> = {
  general: {
    icon: Compass,
    description: 'Questions, explanations and preparation',
    title: 'Start with a question.',
    prompts: [
      'Help me explain a technical decision. Ask me for the context first.',
      'Help me break down this question and identify what I need to clarify: ',
      'I do not know this topic yet. Explain the fundamentals, then check my understanding: ',
    ],
  },
  repoInterview: {
    icon: FolderCode,
    description: 'Files, call paths and evidence',
    title: 'Understand the code in front of you.',
    prompts: [],
  },
  coding: {
    icon: Code2,
    description: 'Approaches, code and edge cases',
    title: 'Work through the problem.',
    prompts: [
      'Help me clarify the requirements and compare approaches for this problem: ',
      'Review this code for a bug. Explain the failing case before suggesting a fix:\n\n',
      'Explain the time and space complexity of this code, including edge cases:\n\n',
    ],
  },
  systemDesign: {
    icon: Network,
    description: 'Requirements, architecture and tradeoffs',
    title: 'Make the tradeoffs clear.',
    prompts: [
      'Help me scope the requirements for this system. Ask about scale and constraints first: ',
      'Compare two architecture options for this use case: ',
      'Review this design for bottlenecks and failure modes: ',
    ],
  },
  behavioral: {
    icon: MessagesSquare,
    description: 'Your experience, clearly structured',
    title: 'Build an answer from your experience.',
    prompts: [
      'Help me structure a real experience using STAR. Ask me for the situation, my actions and the outcome.',
      'Help me explain a disagreement constructively using these facts: ',
      'Help me discuss an honest mistake and what I learned from it: ',
    ],
  },
}

export function WorkspaceModeNavigation({ mode, onChange }: { mode: CopilotMode; onChange: (mode: CopilotMode) => void }) {
  return (
    <section aria-label="Interview focus" className="px-4 py-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-black/50">Interview focus</p>
      <div className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
        {MODE_ORDER.map((item) => {
          const { icon: Icon, description } = WORKSPACE_MODES[item]
          return (
            <button key={item} type="button" aria-label={MODE_PROFILES[item].label} aria-pressed={mode === item} data-active={mode === item} onClick={() => onChange(item)}
              className="group flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-black/60 transition-colors hover:bg-black/5 active:bg-black/10 data-[active=true]:bg-emerald-700/10 data-[active=true]:text-[color:var(--signal)]">
              <Icon size={17} aria-hidden className="shrink-0" />
              <span className="min-w-0">
                <span className="block font-medium">{MODE_PROFILES[item].label}</span>
                <span className="mt-0.5 hidden text-[11px] leading-relaxed text-black/50 lg:block">{description}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

export function ResponsePreferencesControls({ preferences, setFormat, setTone, setFollowups, compact = false }: {
  preferences: AnswerPreferences
  setFormat: (value: AnswerPreferences['format']) => void
  setTone: (value: AnswerPreferences['tone']) => void
  setFollowups: (value: boolean) => void
  compact?: boolean
}) {
  return (
    <div className={`space-y-3 ${compact ? 'py-2' : 'px-4 py-4'}`}>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-ink">Answer format</legend>
        <div className="grid grid-cols-3 gap-1 rounded-xl border border-black/10 bg-white/60 p-1">
          {(['keywords', 'concise', 'detailed'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={preferences.format === value} data-active={preferences.format === value} onClick={() => setFormat(value)}
              className="min-h-11 rounded-lg px-1.5 text-xs text-black/60 transition-colors hover:bg-black/5 data-[active=true]:bg-ink data-[active=true]:text-white">
              {value === 'keywords' ? 'Keywords' : value === 'concise' ? 'Concise' : 'Detailed'}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-xs font-semibold text-ink">
        Answer tone
        <select value={preferences.tone} onChange={(event) => setTone(event.target.value as AnswerPreferences['tone'])}
          className="mt-1.5 min-h-11 w-full rounded-xl border border-black/15 bg-white/70 px-3 py-2 text-sm font-normal text-ink">
          <option value="collaborative">Collaborative</option>
          <option value="technical">Technical</option>
          <option value="strategic">Strategic</option>
        </select>
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg text-xs leading-relaxed text-black/70">
        <input type="checkbox" checked={preferences.followups} onChange={(event) => setFollowups(event.target.checked)} className="h-4 w-4 shrink-0 accent-[color:var(--signal)]" />
        Include likely follow-up questions
      </label>
      <p className="text-[11px] leading-relaxed text-black/50">Applies to your next answer. Technical evidence and runnable code remain available in every format.</p>
    </div>
  )
}

export function WorkspaceEmptyState({ mode, onChoose, onAddContext }: { mode: CopilotMode; onChoose: (value: string) => void; onAddContext: () => void }) {
  const { icon: Icon, title, prompts } = WORKSPACE_MODES[mode]
  return (
    <div className="mx-auto w-full max-w-2xl py-7 sm:py-12">
      <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-700/15 bg-emerald-700/5 text-[color:var(--signal)]"><Icon size={21} aria-hidden /></div>
      <h2 className="font-[family-name:var(--font-serif)] text-2xl leading-tight text-ink sm:text-3xl">{title}</h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-black/60">Type or paste a question below. Add your background or supporting material when it helps. No meeting or recording is needed.</p>
      <div className="mt-7 space-y-2">
        {prompts.map((prompt) => (
          <button key={prompt} type="button" onClick={() => onChoose(prompt)}
            className="group flex min-h-12 w-full items-center gap-4 rounded-xl border border-black/10 bg-white/60 px-4 py-3 text-left text-sm leading-relaxed text-black/70 transition-colors hover:border-emerald-700/30 hover:bg-emerald-700/5 active:bg-emerald-700/10">
            <span className="flex-1">{prompt.trim()}</span><ArrowUpRight size={15} aria-hidden className="shrink-0 text-black/40 group-hover:text-[color:var(--signal)]" />
          </button>
        ))}
      </div>
      <button type="button" onClick={onAddContext} className="mt-5 min-h-11 text-sm font-medium text-[color:var(--signal)] underline-offset-4 hover:underline">Add resume, job description or notes</button>
    </div>
  )
}
