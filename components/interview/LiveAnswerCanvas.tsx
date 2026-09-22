'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react'
import { ResponsePreferencesControls } from '@/components/copilot/CopilotWorkspaceUi'
import { useResponsePreferences } from '@/lib/copilot/useResponsePreferences'
import { Markdown } from '@/components/copilot/Markdown'
import { useAnswerFeed } from '@/lib/copilot/useAnswerFeed'
import { useOrchestrationRouter } from '@/lib/copilot/useOrchestrationRouter'
import { useProactive } from '@/lib/copilot/useProactive'
import { useCandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { useMeContext } from '@/lib/copilot/useMeContext'
import { useModeContext } from '@/lib/copilot/useModeContext'
import type { CopilotMode } from '@/lib/copilot/modes'

const MODE_LABEL: Record<string, string> = { general: 'General', coding: 'Coding', systemDesign: 'System Design', behavioral: 'Behavioral', repoInterview: 'Repository' }

export function LiveAnswerCanvas({ getTranscript, getQuestionTranscript = getTranscript, instructions }: { getTranscript: () => string; getQuestionTranscript?: () => string; instructions: string }) {
  const responsePreferences = useResponsePreferences()
  const feed = useAnswerFeed(responsePreferences.preferences)
  const router = useOrchestrationRouter()
  const profile = useCandidateProfile()
  const me = useMeContext()
  const context = useModeContext('general')
  const [mode, setMode] = useState<CopilotMode>('general')
  const [routing, setRouting] = useState(false)
  const [paused, setPaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1 } }, [])

  const answerQuestion = useCallback(async (question: string) => {
    const token = ++generation.current
    const valid = () => mounted.current && token === generation.current
    setRouting(true); setError(null)
    try {
      const routed = await router.route(question)
      if (!valid()) return
      // Repository interviews keep their dedicated evidence pipeline outside Live.
      const answerMode: CopilotMode = routed.classification?.mode === 'repoInterview' ? 'general' : (routed.classification?.mode ?? 'general')
      setMode(answerMode)
      const retrieved = context.count > 0 ? await context.retrieve(question) : null
      if (!valid()) return
      const grounded = [
        routed.webContext && `LIVE WEB RESULTS:\n${routed.webContext}`,
        profile.contextBlock(),
        me.getMeContext() && `What I said: ${me.getMeContext()}`,
        retrieved,
      ].filter(Boolean).join('\n\n') || null
      await feed.answer(question, answerMode, grounded, null, instructions || context.instructions || null, getTranscript())
    } catch (failure) {
      if (valid()) setError(failure instanceof Error ? failure.message : 'Could not prepare this question. Try again.')
    } finally { if (valid()) setRouting(false) }
  }, [router, context, profile, me, feed, instructions, getTranscript])

  const proactive = useProactive(!paused, getQuestionTranscript, answerQuestion)
  const current = feed.current
  const activeQuestion = current?.question || proactive.lastAsked

  function toggleAnswers() {
    if (!paused) { generation.current += 1; feed.stop(); setRouting(false) }
    setPaused((value) => !value)
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
      <details className="max-w-sm text-xs"><summary className="min-h-9 cursor-pointer py-2 font-medium text-black/55">Answer preferences</summary><ResponsePreferencesControls {...responsePreferences} compact /></details>
      <button type="button" onClick={toggleAnswers} className="btn-ghost min-h-9 text-xs">{paused ? 'Resume answers' : 'Pause answers'}</button>
    </div>
    {paused && <p role="status" className="mb-3 text-xs text-black/55">Answers paused. Audio capture continues until you end the interview.</p>}
    {error && <p role="alert" className="mb-3 text-sm text-[color:var(--stop)]">{error}</p>}
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 font-semibold text-emerald-700">Question detection</span>
      <span className="rounded-full bg-black/[0.045] px-2.5 py-1 font-medium text-black/55">{MODE_LABEL[mode]}</span>
      {(routing || current?.streaming) && <span className="ml-auto inline-flex items-center gap-1.5 text-black/40"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />{routing ? 'Routing…' : 'Answering…'}</span>}
    </div>
    <div className="mt-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-black/35">Current question</p>
      <h2 className="mt-2 max-w-3xl text-2xl font-semibold leading-tight tracking-[-0.025em] sm:text-3xl">{activeQuestion || 'Listening for the next question…'}</h2>
    </div>
    <div className="mt-5 min-h-0 flex-1 overflow-y-auto rounded-xl border border-black/[0.07] bg-black/[0.018] p-4 sm:p-5">
      {!current ? <div className="flex min-h-48 items-center justify-center text-sm text-black/35">The answer appears here automatically.</div> :
        current.failed ? <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-center"><p className="text-sm text-black/50">The answer did not complete.</p><button className="btn-ghost gap-2" onClick={() => feed.retry(current.id)}><RotateCcw size={14} />Retry</button></div> :
        <div className="max-w-none break-words text-[15px] leading-7 text-ink sm:text-base"><Markdown>{current.answer || 'Preparing answer…'}</Markdown></div>}
    </div>
    {feed.count > 0 && <div className="mt-3 flex items-center gap-2 text-xs text-black/45">
      <button aria-label="Previous answer" disabled={feed.cursor <= 0} onClick={feed.prev} className="rounded-lg p-2 hover:bg-black/[0.04] disabled:opacity-25"><ChevronLeft size={15} /></button>
      <span>{feed.cursor + 1} / {feed.count}</span>
      <button aria-label="Next answer" disabled={feed.cursor >= feed.count - 1} onClick={feed.next} className="rounded-lg p-2 hover:bg-black/[0.04] disabled:opacity-25"><ChevronRight size={15} /></button>
      <span className="ml-auto">{MODE_LABEL[mode]}</span>
    </div>}
  </div>
}
