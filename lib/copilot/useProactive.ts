'use client'
import { useEffect, useRef, useState } from 'react'
import { questionCandidates, type QuestionCandidate } from './questionDetection'
export { latestQuestion, latestQuestionGroup } from './questionDetection'

const POLL_MS = 300
const SETTLE_MS = 900
const MAX_QUEUE = 4
/** Detect while a model is busy. Latest-wins callers cancel superseded work;
 * serial callers retain a bounded queue. Static text, revisions and toggling
 * cannot repeatedly bill the same candidate. Failures never auto-retry here. */
export function useProactive(enabled: boolean, getTranscript: () => string,
  onQuestion: (q: string) => void | Promise<void>, options: { latestWins?: boolean } = {}) {
  const [lastAsked, setLastAsked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const callback = useRef(onQuestion), getter = useRef(getTranscript)
  const seen = useRef(new Set<string>())
  const queue = useRef<QuestionCandidate[]>([])
  const pending = useRef<{ key: string; since: number } | null>(null)
  const flight = useRef(0), serial = useRef(0)
  useEffect(() => { callback.current = onQuestion; getter.current = getTranscript }, [onQuestion, getTranscript])
  const latestWins = options.latestWins === true
  useEffect(() => {
    if (!enabled) return
    let mounted = true, snapshot = ''
    const remember = (key: string) => {
      seen.current.add(key)
      if (seen.current.size > 128) seen.current.delete(seen.current.values().next().value!)
    }
    const dispatch = (candidate: QuestionCandidate) => {
      const token = ++serial.current
      flight.current = token
      setError(null); setLastAsked(candidate.question)
      // Start sync callbacks immediately, but contain thrown/rejected callbacks.
      let result: void | Promise<void>
      try { result = callback.current(candidate.question) }
      catch (failure) { result = Promise.reject(failure) }
      void Promise.resolve(result).catch(failure => {
        if (mounted && flight.current === token) setError(failure instanceof Error ? failure.message : 'Could not answer this question.')
      }).finally(() => { if (mounted && flight.current === token) flight.current = 0 })
    }
    const tick = () => {
      const transcript = getter.current()
      const changed = transcript !== snapshot
      if (changed || pending.current) {
        snapshot = transcript
        const candidates = questionCandidates(transcript)
        const candidate = candidates.at(-1)
        if (!candidate || seen.current.has(candidate.key)) pending.current = null
        else {
          const now = Date.now()
          if (!pending.current || pending.current.key !== candidate.key) pending.current = { key: candidate.key, since: now }
          if (now - pending.current.since >= (candidate.complete ? POLL_MS : SETTLE_MS)) {
            remember(candidate.key); pending.current = null
            // Replace an extension waiting in the queue rather than answering a
            // half-question and the completed version consecutively.
            queue.current = queue.current.filter(item => item.origin !== candidate.origin)
            queue.current.push(candidate)
            if (queue.current.length > MAX_QUEUE) queue.current.shift()
          }
        }
      }
      if (queue.current.length && (!flight.current || latestWins)) {
        const candidate = latestWins ? queue.current.at(-1)! : queue.current[0]
        queue.current = latestWins ? [] : queue.current.slice(1)
        dispatch(candidate)
      }
    }
    const timer = setInterval(tick, POLL_MS)
    return () => { mounted = false; clearInterval(timer); queue.current = []; pending.current = null; flight.current = 0 }
  }, [enabled, latestWins])
  return { lastAsked, error }
}
