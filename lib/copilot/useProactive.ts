'use client'
import { useEffect, useRef, useState } from 'react'
import { ProactiveEngine } from './proactiveEngine'
export { latestQuestion, latestQuestionGroup } from './questionDetection'

/** The same scheduler runs in Live, Mock, and the deterministic simulator. */
export function useProactive(enabled: boolean, getTranscript: () => string,
  onQuestion: (q: string) => void | Promise<void>, options: { latestWins?: boolean } = {}) {
  const [lastAsked, setLastAsked] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const callback = useRef(onQuestion), getter = useRef(getTranscript)
  useEffect(() => { callback.current = onQuestion; getter.current = getTranscript }, [onQuestion, getTranscript])
  const latestWins = options.latestWins === true
  // Keep question identities across pause/resume, but never callbacks from an old epoch.
  const machine = useRef<ProactiveEngine | null>(null)
  const mode = useRef(latestWins)
  useEffect(() => {
    if (!machine.current || mode.current !== latestWins) {
      machine.current?.stop(); mode.current = latestWins
      machine.current = new ProactiveEngine(() => getter.current(), question => callback.current(question), { latestWins, onAsked: setLastAsked, onError: setError })
    }
    if (enabled) machine.current.start()
    return () => { machine.current?.stop() }
  }, [enabled, latestWins])
  return { lastAsked, error }
}
