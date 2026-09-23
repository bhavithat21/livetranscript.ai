'use client'

import { ArrowUpRight, Code2, Compass, FileText, FolderCode, MessagesSquare, Network, type LucideIcon } from 'lucide-react'
import { MODE_ORDER, MODE_PROFILES, type CopilotMode } from '@/lib/copilot/modes'
import type { AnswerPreferences } from '@/lib/copilot/answerPreferences'

type Starter = { label: string; detail: string; prompt: string }
const WORKSPACE_MODES: Record<CopilotMode, { icon: LucideIcon; description: string; title: string; prompts: Starter[] }> = {
  general: {
    icon: Compass,
    description: 'Questions, explanations and preparation',
    title: 'What would you like to work through?',
    prompts: [
      { label: 'Explain a decision', detail: 'Make your reasoning easy to follow.', prompt: 'Help me explain a technical decision. Ask me for the context first.' },
      { label: 'Break down a question', detail: 'Find the requirements and missing details.', prompt: 'Help me break down this question and identify what I need to clarify: ' },
      { label: 'Learn a concept', detail: 'Build understanding, then test it.', prompt: 'I do not know this topic yet. Explain the fundamentals, then check my understanding: ' },
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
    title: 'Work through the problem, step by step.',
    prompts: [
      { label: 'Compare approaches', detail: 'Clarify constraints before writing code.', prompt: 'Help me clarify the requirements and compare approaches for this problem: ' },
      { label: 'Find a bug', detail: 'Trace the failing case to its cause.', prompt: 'Review this code for a bug. Explain the failing case before suggesting a fix:\n\n' },
      { label: 'Check complexity', detail: 'Reason about cost and edge cases.', prompt: 'Explain the time and space complexity of this code, including edge cases:\n\n' },
    ],
  },
  systemDesign: {
    icon: Network,
    description: 'Requirements, architecture and tradeoffs',
    title: 'Make the architecture and tradeoffs clear.',
    prompts: [
      { label: 'Scope a system', detail: 'Start with scale and requirements.', prompt: 'Help me scope the requirements for this system. Ask about scale and constraints first: ' },
      { label: 'Compare designs', detail: 'Choose an approach with clear tradeoffs.', prompt: 'Compare two architecture options for this use case: ' },
      { label: 'Find failure modes', detail: 'Pressure-test a design before building.', prompt: 'Review this design for bottlenecks and failure modes: ' },
    ],
  },
  behavioral: {
    icon: MessagesSquare,
    description: 'Your experience, clearly structured',
    title: 'Turn your experience into a clear answer.',
    prompts: [
      { label: 'Structure a story', detail: 'Use STAR with your actual experience.', prompt: 'Help me structure a real experience using STAR. Ask me for the situation, my actions and the outcome.' },
      { label: 'Explain a disagreement', detail: 'Show your judgment and collaboration.', prompt: 'Help me explain a disagreement constructively using these facts: ' },
      { label: 'Reflect on a mistake', detail: 'Be specific about what you learned.', prompt: 'Help me discuss an honest mistake and what I learned from it: ' },
    ],
  },
}

export function WorkspaceModeNavigation({ mode, onChange }: { mode: CopilotMode; onChange: (mode: CopilotMode) => void }) {
  return (
    <section aria-label="Interview focus" className="p-3">
      <p className="mb-2 px-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[color:var(--muted)]">Focus</p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-1">
        {MODE_ORDER.map((item) => {
          const { icon: Icon, description } = WORKSPACE_MODES[item]
          return (
            <button key={item} type="button" aria-label={MODE_PROFILES[item].label} title={description} aria-pressed={mode === item} data-active={mode === item} onClick={() => onChange(item)}
              className="group flex min-h-11 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-[color:var(--muted)] transition-colors hover:bg-[color:var(--paper)] data-[active=true]:bg-[color:var(--signal)]/10 data-[active=true]:text-[color:var(--signal)]">
              <Icon size={17} aria-hidden className="shrink-0" />
              <span className="min-w-0 font-medium">{MODE_PROFILES[item].label}</span>
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
    <div className={`space-y-4 ${compact ? 'py-2' : 'px-4 py-4'}`}>
      <fieldset>
        <legend className="mb-2 text-xs font-semibold text-ink">Answer format</legend>
        <div className="grid grid-cols-3 gap-1 rounded-lg border border-[color:var(--line)] bg-[color:var(--paper)] p-1">
          {(['keywords', 'concise', 'detailed'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={preferences.format === value} data-active={preferences.format === value} onClick={() => setFormat(value)}
              className="min-h-11 rounded-md px-1 text-xs text-[color:var(--muted)] transition-colors hover:bg-[color:var(--reader)] data-[active=true]:bg-[color:var(--reader)] data-[active=true]:font-semibold data-[active=true]:text-[color:var(--signal)] data-[active=true]:shadow-sm">
              {value === 'keywords' ? 'Keywords' : value === 'concise' ? 'Concise' : 'Detailed'}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block text-xs font-semibold text-ink">
        Answer tone
        <select value={preferences.tone} onChange={(event) => setTone(event.target.value as AnswerPreferences['tone'])}
          className="mt-2 min-h-11 w-full rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] px-3 py-2 text-sm font-normal text-ink">
          <option value="collaborative">Collaborative</option>
          <option value="technical">Technical</option>
          <option value="strategic">Strategic</option>
        </select>
      </label>
      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-xs leading-relaxed text-[color:var(--muted)]">
        <input type="checkbox" checked={preferences.followups} onChange={(event) => setFollowups(event.target.checked)} className="h-4 w-4 shrink-0 accent-[color:var(--signal)]" />
        Include likely follow-up questions
      </label>
      <p className="text-[11px] leading-relaxed text-[color:var(--muted)]">Used for your next answer. Code and technical evidence remain available in every format.</p>
    </div>
  )
}

export function WorkspaceEmptyState({ mode, onChoose, onAddContext }: { mode: CopilotMode; onChoose: (value: string) => void; onAddContext: () => void }) {
  const { icon: Icon, title, prompts } = WORKSPACE_MODES[mode]
  return (
    <div className="mx-auto w-full max-w-3xl py-5 sm:py-7">
      <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[color:var(--signal)]/10 text-[color:var(--signal)]"><Icon size={21} aria-hidden /></div>
      <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight text-ink">{title}</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-[color:var(--muted)]">Ask a question, paste code, or start with a prompt below. Add context for an answer grounded in your work.</p>
      <div className="mt-5 grid gap-2 sm:grid-cols-3">
        {prompts.map(({ label, detail, prompt }) => (
          <button key={label} type="button" onClick={() => onChoose(prompt)}
            className="group flex min-h-24 flex-col rounded-lg border border-[color:var(--line)] bg-[color:var(--reader)] p-3 text-left transition-colors hover:border-[color:var(--signal)]/40 hover:bg-[color:var(--signal)]/5 active:bg-[color:var(--signal)]/10">
            <span className="flex w-full items-center justify-between gap-2 text-sm font-medium text-ink">{label}<ArrowUpRight size={14} aria-hidden className="shrink-0 text-[color:var(--muted)] group-hover:text-[color:var(--signal)]" /></span>
            <span className="mt-1.5 text-xs leading-relaxed text-[color:var(--muted)]">{detail}</span>
          </button>
        ))}
      </div>
      <button type="button" onClick={onAddContext} className="mt-3 inline-flex min-h-11 items-center gap-2 text-xs font-medium text-[color:var(--signal)] underline-offset-4 hover:underline"><FileText size={14} aria-hidden />Add resume, job description or notes</button>
    </div>
  )
}
