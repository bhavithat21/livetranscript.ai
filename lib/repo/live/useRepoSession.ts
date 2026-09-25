'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useProactive } from '@/lib/copilot/useProactive'
import { compileContext } from './context'
import { createSession, makeEvent, reduceRepoEvent, sameStamp, stampFor } from './engine'
import { requestGuidance } from './client'
import { RepoScheduler } from './scheduler'
import type { EventData, Lane, RepoSession } from './types'
import type { ScreenObservation } from '../screenEvidence'

export function useRepoSession(getQuestionTranscript: () => string, enabled: boolean) {
  const [state, setState] = useState(() => createSession('pending', 0))
  const live = useRef(state), [errors, setErrors] = useState<Partial<Record<Lane, string>>>({}), [busy, setBusy] = useState<Partial<Record<Lane, boolean>>>({}), [streamingSay, setStreamingSay] = useState('')
  const scheduler = useRef(new RepoScheduler()), ready = useRef(false), mounted = useRef(true)
  useEffect(() => { mounted.current = true; const next = createSession(crypto.randomUUID()); live.current = next; ready.current = true; setState(next); return () => { mounted.current = false; ready.current = false; scheduler.current.cancel() } }, [])
  const dispatch = useCallback((event: EventData) => {
    if (!ready.current) return
    const current = live.current
    const next = reduceRepoEvent(current, makeEvent(current, event))
    live.current = next; setState(next)
  }, [])
  const observe = useCallback((observation: ScreenObservation, origin: 'screen' | 'file-import' | 'fixture' = 'screen') => {
    dispatch({ kind: 'observation', data: { observation, origin, activePath: observation.files.length === 1 ? observation.files[0].path : null } })
  }, [dispatch])
  const question = useCallback((raw: string) => { dispatch({ kind: 'question', data: { id: crypto.randomUUID(), raw } }) }, [dispatch])
  useProactive(enabled && !state.paused, getQuestionTranscript, question)
  // Track interviewer constraints even when the utterance isn't a question.
  const transcript = useRef('')
  useEffect(() => {
    if (!enabled) return
    const timer = setInterval(() => {
      const text = getQuestionTranscript()
      if (text === transcript.current) return
      const delta = text.startsWith(transcript.current) ? text.slice(transcript.current.length) : text.slice(-1500)
      transcript.current = text
      if (delta.trim()) dispatch({ kind: 'utterance', data: { text: delta.slice(-4000), speaker: 'interviewer' } })
    }, 500)
    return () => clearInterval(timer)
  }, [enabled, getQuestionTranscript, dispatch])
  useEffect(() => {
    if (!enabled || state.paused || !state.question) { scheduler.current.cancel(); return }
    let active = true
    const snapshot = live.current, stamp = stampFor(snapshot)
    const compiled = compileContext(snapshot)
    async function run(lane: Lane) {
      setBusy(v => ({ ...v, [lane]: true })); setErrors(v => ({ ...v, [lane]: '' }))
      try {
        const result = await scheduler.current.run(lane, stamp, signal => requestGuidance(lane, compiled.text, snapshot.question!.text, signal, lane === 'say' ? text => {
          if (active && mounted.current && live.current.question?.id === stamp.questionId && live.current.codeRevision === stamp.codeRevision) setStreamingSay(text)
        } : undefined), ({ value, elapsedMs }) => {
          if (!mounted.current) return
          if (lane === 'say') dispatch({ kind: 'say', data: { stamp, text: value.text, model: value.model, firstTokenMs: value.firstTokenMs, elapsedMs } })
          else if (value.plan) dispatch({ kind: 'plan', data: { stamp, plan: value.plan, model: value.model, elapsedMs } })
        }, lane === 'say' ? 16000 : 29000)
        if (result === 'budget' && active) setErrors(v => ({ ...v, [lane]: 'Session model budget reached. End this session before starting another.' }))
      } catch (e) { if (active && mounted.current) setErrors(v => ({ ...v, [lane]: e instanceof Error ? e.message : 'Analysis failed' })) }
      finally { if (active && mounted.current) { setBusy(v => ({ ...v, [lane]: false })); if (lane === 'say') setStreamingSay('') } }
    }
    // Speech and code work proceed independently. Local navigation is already visible.
    setStreamingSay('')
    void run('say')
    const timer = setTimeout(() => { if (sameStamp(stamp, stampFor(live.current))) void run(snapshot.edits.some(e => e.status === 'different' || e.status === 'matched') ? 'review' : 'plan') }, 750)
    return () => { active = false; clearTimeout(timer); scheduler.current.cancel(); setStreamingSay('') }
  }, [enabled, state.paused, state.question?.id, state.evidenceRevision, state.codeRevision, dispatch])
  const reset = useCallback(() => { scheduler.current.cancel(); scheduler.current = new RepoScheduler(); const next = createSession(crypto.randomUUID()); live.current = next; setState(next); setErrors({}); setBusy({}); setStreamingSay(''); transcript.current = getQuestionTranscript() }, [getQuestionTranscript])
  const replaceReplay = useCallback((replay: RepoSession) => { scheduler.current.cancel(); ready.current = false; live.current = replay; setState(replay); setStreamingSay(''); setErrors({}); setBusy({}) }, [])
  const retry = useCallback(() => { scheduler.current.retry('say'); scheduler.current.retry('plan'); scheduler.current.retry('review'); const next = { ...live.current, evidenceRevision: live.current.evidenceRevision + 1 }; live.current = next; setState(next) }, [])
  return { state, dispatch, observe, question, reset, replaceReplay, errors, busy, streamingSay, retry, requests: scheduler.current.requests }
}
