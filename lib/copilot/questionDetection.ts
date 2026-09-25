// An interrogative/behavioral cue at the START of the (filler-stripped) clause.
const CUE_RE =
  /^(what|why|how|when|where|who|which|whose|whom|can you|could you|would you|will you|do you|did you|have you|are you|is there|tell me|walk me|describe|explain|give me an example|share|design|implement|write|reverse|find|solve|compare|difference between|what's|whats|how'd|how're|can we|could we|would it|is it|please|debug|fix|optimize|refactor|test)\b/i

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
const SPEAKER_RE = /^\s*(?:Speaker\s+(?:\d+|[A-Z])|Call(?:\s*\/\s*speaker\s+\d+)?|Interviewer(?:\s*\/\s*call)?):\s*/i

function stripLabels(sentence: string): string {
  return sentence.replace(SPEAKER_RE, '').replace(FILLER_RE, '').trim()
}

// A sentence is question-shaped if it ends with '?' OR, after stripping a speaker
// label + leading filler, opens with an interrogative/behavioral cue. ASR
// smart-format often renders spoken questions with a period, so we can't rely on
// '?' alone; and '?' may itself sit after a "Speaker N:" label.
export function looksLikeQuestion(sentence: string): boolean {
  const bare = sentence.replace(SPEAKER_RE, '')
  const clean = stripLabels(bare)
  // Session logistics and quoted self-talk do not need a technical answer.
  if (/^(?:how does (?:that|this) sound|does (?:that|this) (?:sound|make sense)|are you (?:ready|there)|can you (?:hear me|see (?:me|my screen|the screen))|is (?:my|the) (?:audio|screen)|what(?:'s| is) your name)\b/i.test(clean)) return false
  if (/^(?:i(?:'m| am| was)? (?:wondering|thinking|asking)|the (?:question|prompt) (?:says|asks)|he (?:asked|said)|she (?:asked|said))\b/i.test(clean)) return false
  if (/\?\s*$/.test(bare)) return true
  return CUE_RE.test(clean) || /^(?:i(?:'d| would) like you to|i want you to|your task is to)\b/i.test(clean)
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

// A MULTI-PART question is asked in pieces ("Tell me about a challenge. And how did
// you measure it? And what would you change?"). Each piece may end in punctuation, so
// the completion gate fires on the first — but they're ONE question. This gathers the
// TRAILING RUN of consecutive question sentences (a question directly followed by
// more questions, allowing short connective statements between) so the model can
// answer ALL parts together instead of the first in isolation. Returns the combined
// text, or the single latest question if there's only one part.
export function latestQuestionGroup(transcript: string): string | null {
  const sentences = transcript
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
  // Find the last question sentence.
  let end = -1
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (looksLikeQuestion(sentences[i]) && sentences[i].length >= 8) { end = i; break }
  }
  if (end === -1) return null
  // Walk backward collecting the contiguous block of question-ish parts. Stop at a
  // non-question sentence that ISN'T a short connective ("and", "also", "then …").
  let start = end
  for (let i = end - 1; i >= 0 && i >= end - 4; i--) {
    const s = sentences[i]
    if (looksLikeQuestion(s) && s.length >= 8) { start = i; continue }
    break
  }
  const parts = sentences.slice(start, end + 1).map((s) => stripLabels(s) || s)
  return parts.length > 1 ? parts.join(' ') : parts[0]
}


export function normalizeQuestion(q: string): string {
  return q.toLowerCase().replace(/[.!?,;:\s]+/g, '').trim()
}
export function incompleteQuestion(q: string): boolean {
  if (/^(?:(?:can|could|would|will|do|did|have|are|should) (?:you|we)|how(?: would| could| should)? (?:you|we)|what (?:is|are|about)|tell me|walk me through|please|i(?:'d| would) like you to)[.!?,\s]*$/i.test(q)) return true
  return /\b(?:the|a|an|of|to|with|and|or|if|because|which|from|for|would|could|should|your|how|when|where|design|implement|write|explain|describe)[.!?,\s]*$/i.test(q)
}
export type QuestionCandidate = { question: string; origin: number; key: string; complete: boolean }
/** Count occurrences of each normalized question, not preceding sentence count:
 * earlier punctuation/role revisions must not re-bill an unchanged question.
 * Source position is retained only to coalesce queued multi-part extensions. */
export function questionCandidates(transcript: string): QuestionCandidate[] {
  const sentences = transcript.replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/).filter(Boolean)
  const candidates: QuestionCandidate[] = []
  const occurrences = new Map<string, number>()
  let group: string[] = [], origin = 0
  for (let index = 0; index < sentences.length; index++) {
    const sentence = sentences[index]
    if (!looksLikeQuestion(sentence) || sentence.length < 8) { group = []; continue }
    if (!group.length) origin = index
    group.push(stripLabels(sentence) || sentence)
    const question = group.slice(-5).join(' ')
    if (!incompleteQuestion(question)) {
      const normalized = normalizeQuestion(question)
      const occurrence = occurrences.get(normalized) ?? 0
      occurrences.set(normalized, occurrence + 1)
      candidates.push({ question, origin, key: `${occurrence}:${normalized}`, complete: /[.!?]["')\]]?\s*$/.test(question) })
    }
  }
  return candidates
}
