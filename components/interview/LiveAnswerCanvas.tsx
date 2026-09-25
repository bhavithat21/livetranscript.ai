'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AudioLines, ChevronLeft, ChevronRight, Pause, Play, RotateCcw, Settings2, Sparkles } from 'lucide-react'
import { ResponsePreferencesControls } from '@/components/copilot/CopilotWorkspaceUi'
import { useResponsePreferences } from '@/lib/copilot/useResponsePreferences'
import { Markdown } from '@/components/copilot/Markdown'
import { useAnswerFeed } from '@/lib/copilot/useAnswerFeed'
import { useOrchestrationRouter } from '@/lib/copilot/useOrchestrationRouter'
import { useProactive } from '@/lib/copilot/useProactive'
import { useCandidateProfile } from '@/lib/copilot/useCandidateProfile'
import { useMeContext } from '@/lib/copilot/useMeContext'
import { useModeContexts } from '@/lib/copilot/useModeContexts'
import type { CopilotMode } from '@/lib/copilot/modes'
import styles from './Interview.module.css'

const MODE_LABEL: Record<string, string> = { general: 'General', coding: 'Coding', systemDesign: 'System Design', behavioral: 'Behavioral', repoInterview: 'Repository' }

export function LiveAnswerCanvas({ getTranscript, getQuestionTranscript = getTranscript }: { getTranscript: () => string; getQuestionTranscript?: () => string }) {
  const responsePreferences = useResponsePreferences()
  const feed = useAnswerFeed(responsePreferences.preferences)
  const router = useOrchestrationRouter()
  const profile = useCandidateProfile()
  const me = useMeContext()
  const contexts = useModeContexts()
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
    feed.stop()
    setRouting(true); setError(null)
    try {
      const routed = await router.route(question)
      if (!valid()) return
      // Repository interviews keep their dedicated evidence pipeline outside Live.
      const answerMode: CopilotMode = routed.classification?.mode === 'repoInterview' ? 'general' : (routed.classification?.mode ?? 'general')
      setMode(answerMode)
      const context = contexts[answerMode]
      const retrieved = answerMode === 'behavioral' && context.storyCount > 0
        ? await context.retrieveStories(question, 2).then((stories) => stories.map((story) => `STORY — ${story.title}\n${story.fullText}`).join('\n\n'))
        : context.count > 0 ? await context.retrieve(question) : null
      if (!valid()) return
      const grounded = [
        routed.webContext && `LIVE WEB RESULTS:\n${routed.webContext}`,
        profile.contextBlock(),
        me.getMeContext() && `What I said: ${me.getMeContext()}`,
        retrieved,
      ].filter(Boolean).join('\n\n') || null
      setRouting(false)
      await feed.answer(question, answerMode, grounded, null, context.instructions || null, getTranscript())
    } catch (failure) {
      if (valid()) setError(failure instanceof Error ? failure.message : 'Could not prepare this question. Try again.')
    } finally { if (valid()) setRouting(false) }
  }, [router, contexts, profile, me, feed, getTranscript])

  const proactive = useProactive(!paused, getQuestionTranscript, answerQuestion, { latestWins: true })
  const current = feed.current
  const activeQuestion = routing ? proactive.lastAsked : current?.question || proactive.lastAsked

  function toggleAnswers() {
    if (!paused) { generation.current += 1; feed.stop(); setRouting(false) }
    setPaused((value) => !value)
  }

  return <div className={styles.answerCanvas}>
    <div className={styles.answerToolbar}>
      <div className={styles.answerTags}><span className={`${styles.answerTag} ${styles.answerTagActive}`}>{paused ? 'Detection paused' : 'Automatic questions'}</span><span className={styles.answerTag}>{MODE_LABEL[mode]}</span></div>
      <button type="button" onClick={toggleAnswers} className={styles.darkButton}>{paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}{paused ? 'Resume answers' : 'Pause answers'}</button>
    </div>
    {paused && <p role="status" className={styles.livePaused}>Answers paused. Audio capture continues until you end the interview.</p>}
    {(error || proactive.error) && <p role="alert" className={styles.error}>{error || proactive.error}</p>}
    <div className="mt-2"><p className={styles.answerLabel}>Current question</p><h2 className={styles.answerQuestion}>{activeQuestion || 'Listening for the next question…'}</h2></div>
    <section className={styles.answerCard} aria-label="AI answer">
      <div className={styles.answerCardHeader}><span><Sparkles size={16} aria-hidden />AI answer</span><span className={styles.answerProgress} role="status">{routing ? 'Finding context…' : current?.streaming ? 'Answering…' : current?.failed ? 'Needs retry' : current ? 'Ready' : 'Waiting for a question'}</span></div>
      {routing ? <p className={styles.answerEmpty}>Preparing the latest question…</p> : !current ? <div className={styles.answerEmpty}><AudioLines size={27} aria-hidden /><strong>A little context. A clearer answer.</strong><p>The answer appears here automatically when a complete question is detected.</p></div> : current.failed ? <div className={styles.answerEmpty}><p>The answer did not complete.</p><button type="button" className={styles.darkButton} onClick={() => feed.retry(current.id)}><RotateCcw size={14} aria-hidden />Retry</button></div> : <div className={styles.answerMarkdown}><Markdown>{current.answer || 'Preparing answer…'}</Markdown></div>}
    </section>
    {feed.count > 0 && <div className={styles.answerPagination}><button type="button" aria-label="Previous answer" disabled={feed.cursor <= 0} onClick={feed.prev} className={styles.darkButton}><ChevronLeft size={15} aria-hidden /></button><span>Answer {feed.cursor + 1} of {feed.count}</span><button type="button" aria-label="Next answer" disabled={feed.cursor >= feed.count - 1} onClick={feed.next} className={styles.darkButton}><ChevronRight size={15} aria-hidden /></button><span>{MODE_LABEL[mode]}</span></div>}
    <details className={styles.preferences}><summary><Settings2 size={13} aria-hidden />Answer preferences</summary><div className={styles.preferencesBody}><ResponsePreferencesControls {...responsePreferences} compact /></div></details>
  </div>
}
