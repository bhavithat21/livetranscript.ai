'use client'
import { useEffect, useRef, useState } from 'react'

// Proactive auto-answer (opt-in). While ON, it watches the live transcript and,
// when a NEW question is detected, fires the copilot automatically — so in a
// meeting/interview the answer is already there without the user typing.
//
// Guards (so it doesn't spam or burn cost): only fires on question-shaped lines,
// debounces on a brief pause, and dedupes so the same question isn't re-asked.
// Off by default; the panel exposes the toggle.

// An interrogative/behavioral cue at the START of the (filler-stripped) clause.
const CUE_RE =
  /^(what|why|how|when|where|who|which|whose|whom|can you|could you|would you|will you|do you|did you|have you|are you|is there|tell me|walk me|describe|explain|give me an example|share|design|implement|write|reverse|find|solve|compare|difference between|what's|whats|how'd|how're)\b/i

// Leading discourse filler real speakers (and ASR) prepend before the real ask:
// "So tell me…", "Okay, walk me…", "And how would you…", "Great. So, can you…".
// Without stripping these, a `^cue` test misses most spoken questions — which is
// why auto-answer sat on "Listening…" and never fired.
const FILLER_RE =
  /^(?:[\s,.\-–—]*\b(?:so|ok|okay|um|uh|erm|well|and|but|alright|all right|right|now|great|good|cool|yeah|yes|no|hmm|like|actually|basically|first|next|then|also|maybe|perhaps|let's|lets|let me|i guess|you know|i mean|for example)\b[\s,.:;\-–—]*)+/i

// A sentence is question-shaped if it ends with '?' OR, after stripping leading
// filler, opens with an interrogative/behavioral cue. ASR smart-format often
// renders spoken questions with a period, so we can't rely on '?' alone.
function looksLikeQuestion(sentence: string): boolean {
  if (/\?\s*$/.test(sentence)) return true
  return CUE_RE.test(sentence.replace(FILLER_RE, ''))
}

// Pull the most recent question-shaped sentence out of the transcript tail,
// filler-trimmed (also gives the model a cleaner ask). Null if none.
export function latestQuestion(transcript: string): string | null {
  const sentences = transcript
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (looksLikeQuestion(sentences[i]) && sentences[i].length >= 8) {
      return sentences[i].replace(FILLER_RE, '').trim() || sentences[i]
    }
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
