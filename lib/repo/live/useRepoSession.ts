'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useProactive } from '@/lib/copilot/useProactive'
import { compileContext } from './context'
import { stampFor } from './engine'
import { createSession, makeEvent, reduceSession } from './policy'
import { requestGuidance } from './client'
import { RepoScheduler } from './scheduler'
import type { EventData, Lane, RepoSession } from './types'
import type { ScreenObservation } from '../screenEvidence'

const intentFor = (s: RepoSession) => JSON.stringify([s.holdImplementation, s.constraints])
export function useRepoSession(getQuestionTranscript: () => string, enabled: boolean) {
  const [state, setState] = useState(() => createSession('new-session', 0))
  const live = useRef(state), [errors, setErrors] = useState<Partial<Record<Lane, string>>>({}), [busy, setBusy] = useState<Partial<Record<Lane, boolean>>>({}), [streamingSay, setStreamingSay] = useState(''), [retryNonce, setRetryNonce] = useState(0)
  const scheduler = useRef(new RepoScheduler()), mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; scheduler.current.cancel() } }, [])
  const dispatch = useCallback((event: EventData) => {
    const next = reduceSession(live.current, makeEvent(live.current, event))
    if (next.paused) { scheduler.current.cancel(); setBusy({}); setStreamingSay('') }
    live.current = next; setState(next)
  }, [])
  const observe = useCallback((observation: ScreenObservation, origin: 'screen' | 'file-import' | 'fixture' = 'screen') => {
    dispatch({ kind: 'observation', data: { observation, origin, activePath: origin !== 'file-import' && observation.files.length === 1 ? observation.files[0].path : null } })
  }, [dispatch])
  const question = useCallback((raw: string) => { dispatch({ kind: 'question', data: { id: crypto.randomUUID(), raw } }) }, [dispatch])
  useProactive(enabled && !state.paused, getQuestionTranscript, question)
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
  const launch = useCallback((lane: Lane, snapshot: RepoSession) => {
    let active = true
    const stamp = stampFor(snapshot), intent = intentFor(snapshot)
    // A changed screenshot is not a new speaking prompt. A changed instruction is.
    const schedulerStamp = lane === 'say' ? { ...stamp, questionId: stamp.questionId + ':' + intent, evidenceRevision: 0 } : stamp
    const compiled = compileContext(snapshot, lane === 'say' ? 7000 : 24000)
    const current = () => active && mounted.current && live.current.question?.id === stamp.questionId && live.current.codeRevision === stamp.codeRevision && intentFor(live.current) === intent && !live.current.paused
    async function run() {
      if (!current()) return
      setBusy(v => ({ ...v, [lane]: true })); setErrors(v => ({ ...v, [lane]: '' }))
      try {
        const result = await scheduler.current.run(lane, schedulerStamp, signal => requestGuidance(lane, compiled.text, snapshot.question!.text, signal, lane === 'say' ? text => { if (current()) setStreamingSay(text) } : undefined), ({ value, elapsedMs }) => {
          if (!current()) return
          if (lane === 'say') dispatch({ kind: 'say', data: { stamp, text: value.text, model: value.model, firstTokenMs: value.firstTokenMs, elapsedMs } })
          else if (value.plan) dispatch({ kind: 'plan', data: { stamp, plan: value.plan, model: value.model, elapsedMs } })
        }, lane === 'say' ? 16000 : 29000)
        if (result === 'budget' && current()) setErrors(v => ({ ...v, [lane]: 'Session model budget reached. End this session before starting another.' }))
      } catch (e) { if (current()) setErrors(v => ({ ...v, [lane]: e instanceof Error ? e.message : 'Analysis failed' })) }
      finally { if (current()) { setBusy(v => ({ ...v, [lane]: false })); if (lane === 'say') setStreamingSay('') } }
    }
    const timer = setTimeout(() => void run(), lane === 'say' ? 0 : 750)
    return () => { active = false; clearTimeout(timer); scheduler.current.cancel(lane) }
  }, [dispatch])
  const questionId = state.question?.id, intent = intentFor(state)
  useEffect(() => {
    if (!enabled || state.paused || !questionId) return
    return launch('say', live.current)
  }, [enabled, state.paused, questionId, state.codeRevision, intent, retryNonce, launch])
  useEffect(() => {
    if (!enabled || state.paused || !questionId) return
    const snapshot = live.current
    return launch(snapshot.edits.some(e => e.status === 'different' || e.status === 'matched') ? 'review' : 'plan', snapshot)
  }, [enabled, state.paused, questionId, state.evidenceRevision, state.codeRevision, intent, retryNonce, launch])
  const stop = useCallback(() => { scheduler.current.cancel(); dispatch({ kind: 'pause', data: { paused: true } }); setBusy({}); setStreamingSay('') }, [dispatch])
  const reset = useCallback(() => { scheduler.current.cancel(); scheduler.current = new RepoScheduler(); const next = createSession(crypto.randomUUID()); live.current = next; setState(next); setErrors({}); setBusy({}); setStreamingSay(''); transcript.current = getQuestionTranscript() }, [getQuestionTranscript])
  const replaceReplay = useCallback((replay: RepoSession) => { scheduler.current.cancel(); live.current = replay; setState(replay); setStreamingSay(''); setErrors({}); setBusy({}) }, [])
  const retry = useCallback(() => { scheduler.current.retry('say'); scheduler.current.retry('plan'); scheduler.current.retry('review'); setRetryNonce(n => n + 1) }, [])
  return { state, dispatch, observe, question, reset, stop, replaceReplay, errors, busy, streamingSay, retry, requests: scheduler.current.requests }
}
