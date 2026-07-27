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

// A diarized transcript prefixes each finalized line with "Speaker N: " (default
// on for AssemblyAI/Deepgram). That label pushes the interrogative cue off the
// START of the sentence, so CUE_RE would miss "Speaker 2: Walk me through…" — i.e.
// auto-answer would silently sit on "Listening…" for every period-ended spoken
// question in a real (diarized) interview. Strip the label first, everywhere the
// sentence is tested or returned.
const SPEAKER_RE = /^\s*Speaker\s+\d+:\s*/i

function stripLabels(sentence: string): string {
  return sentence.replace(SPEAKER_RE, '').replace(FILLER_RE, '').trim()
}

// A sentence is question-shaped if it ends with '?' OR, after stripping a speaker
// label + leading filler, opens with an interrogative/behavioral cue. ASR
// smart-format often renders spoken questions with a period, so we can't rely on
// '?' alone; and '?' may itself sit after a "Speaker N:" label.
function looksLikeQuestion(sentence: string): boolean {
  const bare = sentence.replace(SPEAKER_RE, '')
  if (/\?\s*$/.test(bare)) return true
  return CUE_RE.test(bare.replace(FILLER_RE, ''))
}

// Pull the most recent question-shaped sentence out of the transcript tail, with
// the speaker label + leading filler trimmed (a cleaner ask for the model, and no
// "Speaker N:" leaking into the Answers feed). Null if none.
export function latestQuestion(transcript: string): string | null {
  const sentences = transcript
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (looksLikeQuestion(sentences[i]) && sentences[i].length >= 8) {
      return stripLabels(sentences[i]) || sentences[i]
    }
  }
  return null
}

// Poll fast so a heard question turns into an answer with minimal lag. The
// in-flight guard + prefix-dedupe below keep this from stacking duplicate calls,
// so a short interval is safe (was 1500ms, which added up to 1.5s of dead wait).
const DEBOUNCE_MS = 600

// Normalize for dedupe: lowercase, collapse whitespace, drop trailing punctuation
// so "reverse a linked list" and "Reverse a linked list?" are one question.
function normalizeKey(q: string): string {
  return q.toLowerCase().replace(/\s+/g, ' ').replace(/[.?!,\s]+$/, '').trim()
}

// The tail of a spoken question keeps growing as ASR revises finals, so a new
// candidate that's a prefix/extension of one already asked is the SAME question.
function isSameOrExtension(a: string, b: string): boolean {
  return a === b || a.startsWith(b) || b.startsWith(a)
}

// Answering a question is a race: too early = a half-spoken FRAGMENT, too late =
// dead latency (which we do NOT want). The resolution: fire IMMEDIATELY when the
// candidate looks COMPLETE, and only wait when it genuinely might still be forming.
// The completion signal is free — streaming ASR (AssemblyAI/Deepgram smart-format)
// emits TERMINAL PUNCTUATION (. ! ?) exactly when it detects end-of-utterance, i.e.
// the speaker finished. So:
//   - ends with . ! ? → the utterance is done → fire on the next poll, NO extra wait
//     (the common case pays zero latency).
//   - no terminal punctuation yet → still forming → wait this SETTLE_MS as a backstop
//     (covers ASR configs that don't punctuate) before answering the fragment.
const SETTLE_MS = 900

// A candidate whose text ends in terminal punctuation = the speaker finished.
function isComplete(q: string): boolean {
  return /[.!?]["')\]]?\s*$/.test(q.trim())
}

export function useProactive(
  enabled: boolean,
  getTranscript: () => string,
  // May return a promise that resolves when the answer finishes — the in-flight
  // guard holds until then so ASR tail-revisions don't stack duplicate answers.
  onQuestion: (q: string) => void | Promise<void>,
) {
  const [lastAsked, setLastAsked] = useState<string | null>(null)
  const askedRef = useRef<string[]>([])
  const inFlightRef = useRef(false)
  const onQuestionRef = useRef(onQuestion)
  onQuestionRef.current = onQuestion
  const getRef = useRef(getTranscript)
  getRef.current = getTranscript
  // The candidate question we're WAITING on, its normalized key, and when it last
  // changed — the basis for "has it stopped growing?".
  const pendingRef = useRef<{ q: string; key: string; since: number } | null>(null)

  useEffect(() => {
    if (!enabled) {
      pendingRef.current = null
      return
    }
    const id = setInterval(() => {
      if (inFlightRef.current) return // don't stack answers while one is generating
      const q = latestQuestion(getRef.current())
      if (!q) {
        pendingRef.current = null
        return
      }
      const key = normalizeKey(q)
      // Already answered (or a tail-extension of one we answered)? Skip.
      if (askedRef.current.some((k) => isSameOrExtension(k, key))) {
        pendingRef.current = null
        return
      }
      const now = Date.now()

      // FAST PATH: the candidate is COMPLETE (ends in terminal punctuation → ASR
      // says the speaker finished). Answer NOW — no settle wait, no added latency.
      if (isComplete(q)) {
        askedRef.current.push(key)
        pendingRef.current = null
        inFlightRef.current = true
        setLastAsked(q)
        Promise.resolve(onQuestionRef.current(q)).finally(() => {
          inFlightRef.current = false
        })
        return
      }

      // SLOW PATH: no terminal punctuation yet — the question may still be forming.
      // Only here do we wait (a backstop for ASR that doesn't punctuate). Reset the
      // clock whenever the text grows; fire once it's been stable for SETTLE_MS.
      const pending = pendingRef.current
      if (!pending || pending.key !== key) {
        pendingRef.current = { q, key, since: now }
        return
      }
      if (now - pending.since < SETTLE_MS) return // still forming, keep waiting

      askedRef.current.push(key)
      pendingRef.current = null
      inFlightRef.current = true
      setLastAsked(q)
      Promise.resolve(onQuestionRef.current(q)).finally(() => {
        inFlightRef.current = false
      })
    }, DEBOUNCE_MS)
    return () => clearInterval(id)
  }, [enabled])

  return { lastAsked }
}
