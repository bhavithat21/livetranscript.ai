'use client'

import { useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, FileCode2, FolderOpen, MapPin, Trash2 } from 'lucide-react'
import type { useRepoInterview } from '@/lib/repo/useRepoInterview'

type RepoInterview = ReturnType<typeof useRepoInterview>

export function RepoInterviewPanel({ repo, onAnswer, answering = false, onSelect }: { repo: RepoInterview; onAnswer: (question: string, id: string) => void; answering?: boolean; onSelect?: (question: string, id: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState(true)

  return (
    <section className="border-b border-black/10 bg-emerald-950/[0.035]">
      <div className="flex items-center gap-2 px-4 py-2">
        <MapPin size={14} className="text-emerald-800" />
        <button onClick={() => setExpanded((value) => !value)} className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-semibold">
          <span className="truncate">{repo.index ? `${repo.index.name} · ${repo.index.files.length} files` : 'Connect interview repository'}</span>
          {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
        {repo.questions.length > 0 && <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] text-white">{repo.questions.length} questions</span>}
      </div>

      {expanded && (
        <div className="space-y-3 px-4 pb-3">
          <div className="flex items-center gap-2">
            <button onClick={() => inputRef.current?.click()} disabled={repo.loading} className="btn-ghost flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-50">
              <FolderOpen size={13} /> {repo.loading ? 'Indexing…' : repo.index ? 'Replace folder' : 'Choose folder'}
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              // React does not type Chromium's directory picker attribute yet.
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(event) => void repo.loadFiles(event.target.files)}
              className="hidden"
            />
            <span className="text-[10px] leading-tight text-black/45">Optional folder import. Matching code is sent to AI when you ask; common secret paths and build output are skipped.</span>
          </div>
          {repo.error && <p className="text-xs text-[color:var(--stop)]">{repo.error}</p>}

          {repo.selected && (
            <div className="rounded-xl border border-black/10 bg-white/70 p-2.5">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-800">Current interviewer question</p>
                  <p className="mt-1 text-xs leading-relaxed text-ink">{repo.selected.text}</p>
                </div>
                <button disabled={answering} onClick={() => onAnswer(repo.selected!.text, repo.selected!.id)} className="btn-signal shrink-0 px-2.5 py-1 text-xs disabled:opacity-40">{repo.selected.status === 'failed' ? 'Retry' : 'Answer'}</button>
              </div>
              {repo.matches.length > 0 && (
                <div className="mt-2 border-t border-black/10 pt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40">Navigate first</p>
                  <ol className="mt-1 space-y-1">
                    {repo.matches.slice(0, 3).map((match, index) => (
                      <li key={match.path} className="flex items-start gap-1.5 text-[11px]">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-700/10 text-[9px] font-semibold text-emerald-800">{index + 1}</span>
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-ink" title={match.path}>{match.path}</span>
                          <span className="block truncate text-black/45">{match.symbols.slice(0, 4).join(', ') || match.reason}</span>
                        </span>
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {repo.questions.length > 0 && (
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-black/40">Question ledger</p>
                <button onClick={repo.clearQuestions} title="Clear question ledger" className="text-black/35 hover:text-[color:var(--stop)]"><Trash2 size={12} /></button>
              </div>
              <div className="mt-1 max-h-28 space-y-1 overflow-y-auto">
                {[...repo.questions].reverse().map((question) => (
                  <button
                    key={question.id}
                    onClick={() => { repo.setSelectedId(question.id); onSelect?.(question.text, question.id) }}
                    data-active={repo.selectedId === question.id}
                    className="flex w-full items-start gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] text-black/60 hover:bg-black/[0.04] data-[active=true]:bg-emerald-700/10 data-[active=true]:text-ink"
                  >
                    {question.status === 'answered' ? <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-700" /> : <FileCode2 size={12} className="mt-0.5 shrink-0" />}
                    <span><span className="line-clamp-2">{question.text}</span><span className="text-[10px] opacity-65">{question.status}</span></span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
