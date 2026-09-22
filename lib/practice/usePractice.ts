'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { parsePracticeResponse } from './protocol'
import { MAX_PRACTICE_TURNS, type DeliveryMetrics, type PracticeRequest, type PracticeResponse, type PracticeSession, type PracticeSettings } from './types'

export function usePractice() {
  const [session, setSession] = useState<PracticeSession | null>(null)
  const [busy, setBusy] = useState<PracticeRequest['action'] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const sessionRef = useRef<PracticeSession | null>(null)
  const pending = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  const update = useCallback((next: PracticeSession | null) => {
    sessionRef.current = next
    setSession(next)
  }, [])
  const cancel = useCallback(() => {
    pending.current?.abort()
    pending.current = null
    if (mounted.current) { setBusy(null); setError(null) }
  }, [])
  useEffect(() => {
    mounted.current = true
    const onHide = () => cancel()
    window.addEventListener('pagehide', onHide)
    return () => { mounted.current = false; window.removeEventListener('pagehide', onHide); cancel() }
  }, [cancel])

  const request = useCallback(async (input: PracticeRequest): Promise<PracticeResponse | null> => {
    if (pending.current || !mounted.current) return null
    const controller = new AbortController()
    pending.current = controller
    setBusy(input.action)
    setError(null)
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, 40_000)
    const current = () => mounted.current && pending.current === controller
    try {
      const response = await fetch('/api/copilot/practice', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input), signal: controller.signal,
      })
      if (!current() || controller.signal.aborted) return null
      if (response.status === 401 || response.status === 403) throw new Error('Sign in to continue your practice interview. Your answer is kept in this tab.')
      let body
      try { body = await response.json() }
      catch { throw new Error('The coach could not be reached. Check that you are signed in and try again.') }
      if (!current() || controller.signal.aborted) return null
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The coach is unavailable. Try again.')
      if (typeof body?.model !== 'string' || body.model.length > 150) throw new Error('The coach returned an incomplete response. Try again.')
      return parsePracticeResponse(JSON.stringify(body), input, body.model)
    } catch (cause) {
      if (current()) setError(timedOut ? 'The coach took too long. Your answer is kept; try again.' : cause instanceof Error ? cause.message : 'Practice request failed. Try again.')
      return null
    } finally {
      clearTimeout(timeout)
      if (current()) { pending.current = null; setBusy(null) }
    }
  }, [])

  const start = useCallback(async (settings: PracticeSettings) => {
    const response = await request({ ...settings, action: 'start', turns: [] })
    if (!response) return false
    update({ ...settings, question: response.question!, focus: response.focus!, turns: [], phase: 'answering', report: null, model: response.model })
    return true
  }, [request, update])
  const submit = useCallback(async (answer: string, metrics: DeliveryMetrics) => {
    const current = sessionRef.current
    if (!current || current.phase !== 'answering' || current.turns.length >= MAX_PRACTICE_TURNS) return false
    const response = await request({
      role: current.role, kind: current.kind, context: current.context,
      action: 'answer', turns: current.turns.map(({ question, answer }) => ({ question, answer })),
      question: current.question, answer: answer.trim(),
    })
    if (!response?.feedback) return false
    update({ ...current, question: response.question!, focus: response.focus!, model: response.model, phase: 'feedback', turns: [...current.turns, { question: current.question, answer: answer.trim(), feedback: response.feedback, metrics }] })
    return true
  }, [request, update])
  const next = useCallback(() => {
    const current = sessionRef.current
    if (!pending.current && current?.phase === 'feedback' && current.question) update({ ...current, phase: 'answering' })
  }, [update])
  const finish = useCallback(async () => {
    const current = sessionRef.current
    if (!current?.turns.length) return false
    const response = await request({ role: current.role, kind: current.kind, context: current.context, action: 'report', turns: current.turns.map(({ question, answer }) => ({ question, answer })) })
    if (!response?.report) return false
    update({ ...current, report: response.report, model: response.model, phase: 'report' })
    return true
  }, [request, update])
  const reset = useCallback(() => { cancel(); update(null) }, [cancel, update])

  return { session, busy, error, start, submit, next, finish, cancel, reset }
}
