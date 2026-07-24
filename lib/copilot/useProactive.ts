'use client'
import { useEffect, useRef, useState } from 'react'

// Proactive auto-answer (opt-in). While ON, it watches the live transcript and,
// when a NEW question is detected, fires the copilot automatically — so in a
// meeting/interview the answer is already there without the user typing.
//
// Guards (so it doesn't spam or burn cost): only fires on question-shaped lines,
// debounces on a brief pause, and dedupes so the same question isn't re-asked.
// Off by default; the panel exposes the toggle.

// Question-shaped: ends with '?', or opens with an interrogative/behavioral cue.
const QUESTION_RE =
  /(\?\s*$)|^(what|why|how|when|where|who|which|can you|could you|would you|tell me|walk me|describe|explain|give me an example|do you|have you|design|implement|write|reverse|find|solve)\b/i

// Pull the most recent question-shaped sentence out of the transcript tail.
export function latestQuestion(transcript: string): string | null {
  const sentences = transcript
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (QUESTION_RE.test(sentences[i]) && sentences[i].length >= 8) return sentences[i]
  }
  return null
}

const DEBOUNCE_MS = 1500

export function useProactive(
  enabled: boolean,
  getTranscript: () => string,
  onQuestion: (q: string) => void,
) {
  const [lastAsked, setLastAsked] = useState<string | null>(null)
  const askedRef = useRef<Set<string>>(new Set())
  const onQuestionRef = useRef(onQuestion)
  onQuestionRef.current = onQuestion
  const getRef = useRef(getTranscript)
  getRef.current = getTranscript

  useEffect(() => {
    if (!enabled) return
    // Poll the transcript on a debounce; fire when a fresh question appears.
    const id = setInterval(() => {
      const q = latestQuestion(getRef.current())
      if (!q) return
      const key = q.toLowerCase()
      if (askedRef.current.has(key)) return // already answered this one
      askedRef.current.add(key)
      setLastAsked(q)
      onQuestionRef.current(q)
    }, DEBOUNCE_MS)
    return () => clearInterval(id)
  }, [enabled])

  return { lastAsked }
}
