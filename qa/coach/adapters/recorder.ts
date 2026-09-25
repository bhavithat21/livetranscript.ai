import { useCallback, useEffect, useRef, useState } from 'react'
import type { CapturedSegment, CapturePhase } from '../../../lib/interview/useInterviewRecorder'
export { liveTranscript, captureText } from '../../../lib/interview/useInterviewRecorder'
const listeners = new Set<(text: string, source: string, speaker: number | null) => void>()
export function injectSpeech(text: string, source = 'system', speaker: number | null = 0) { listeners.forEach(listener => listener(text, source, speaker)) }
/** Explicit ASR/device fixture. Does not request a microphone or call an ASR service. */
export function useInterviewRecorder() {
  const [phase, setPhase] = useState<CapturePhase>('idle')
  const [segments, setSegments] = useState<CapturedSegment[]>([])
  const rows = useRef<CapturedSegment[]>([]), active = useRef(false), input = useRef('')
  useEffect(() => {
    const update = (text: string, source: string, speaker: number | null) => {
      if (!active.current || input.current !== source) return
      const row: CapturedSegment = { id: rows.current.length + 1, text, capturedAt: Date.now(), speaker, isFinal: true }
      rows.current = [...rows.current, row]; setSegments(rows.current)
    }
    listeners.add(update)
    return () => { active.current = false; listeners.delete(update) }
  }, [])
  const start = useCallback(async (source: string) => { input.current = source; active.current = true; rows.current = []; setSegments([]); setPhase('recording') }, [])
  const stop = useCallback(async () => { active.current = false; setPhase('idle'); return rows.current.slice() }, [])
  const getSegments = useCallback(() => rows.current.slice(), [])
  return { start, stop, getSegments, segments, phase, error: null, level: 0 }
}
