import type { CopilotMode } from './modes'

// Zero-network, zero-latency question classifier. Most interview questions are
// UNAMBIGUOUS from keywords ("reverse a linked list" → coding, "tell me about a time"
// → behavioral, "design a system that scales" → systemDesign). Handling those locally
// removes the classifier round-trip from the hot path entirely — the LLM classifier
// is only called when local is UNCERTAIN. This is the fix for the latency tax the
// network-only router added: answer the common case instantly, escalate the rest.
//
// Returns null when it's not confident enough — the caller then falls to the LLM
// classifier (useOrchestrationRouter). Deliberately conservative: a wrong-but-
// confident local guess is worse than escalating, so ties/weak signals return null.

export type LocalClassification = {
  mode: CopilotMode
  needsWeb: boolean
  isQuestion: boolean
}

// STRONG per-mode signals — an unambiguous interview stem. One strong hit is
// high-confidence and routes locally. These are phrases that essentially only appear
// as that question type (not bare high-frequency words).
const BEHAVIORAL_RE =
  /\b(tell me about a time|give me an example of|describe a (?:time|situation)|a time when you|walk me through a time|tell me about a (?:conflict|disagreement|failure|mistake)|time you (?:disagreed|failed|led|mentored))\b/i
const CODING_RE =
  /\b(reverse a|implement (?:a |the )?(?:function|algorithm|method|class|stack|queue|hash ?map|linked list|binary)|write (?:a )?(?:function|code|algorithm)|two sum|linked list|binary (?:tree|search)|palindrome|fibonacci|time complexity|big o|leetcode|debug this|refactor this|code this)\b/i
const SYSTEM_DESIGN_RE =
  /\b(system design|architect(?:ure)?|design (?:a|an|the) (?:system|service|api|pipeline|database|scalable|distributed)|scal(?:e|ing)\b[^.?]*\b(?:to|billion|million|requests|users|traffic|qps)|scalab|throughput|load balanc|shard|url shortener|news feed|microservice|high availability|caching layer)\b/i

// WEAK signals — bare high-frequency words (conflict, feedback, sort the, design the)
// that OFTEN mean something else ("resolve a git merge conflict", "design the perfect
// team culture"). A weak-only match must NOT be treated as confident — it escalates
// to the LLM classifier instead of guessing. Presence here is used only to DETECT
// ambiguity (so we don't confidently route on a weak token alone).
const WEAK_RE =
  /\b(conflict|feedback|failure|mistake|proud of|leadership|mentor|sort (?:this|the|a|an )|design (?:a|an|the)|scale (?:this|it|them|up|out))\b/i
// Freshness signals → the answer needs LIVE web facts.
const WEB_RE =
  /\b(latest|newest|current(?:ly)?|as of (?:now|today|this)|right now|this (?:year|week|month)|recent(?:ly)?|202[4-9]|today'?s|up to date|most recent|just (?:released|announced))\b/i

// A question-shape check independent of mode (mirrors useProactive's intent, kept
// simple here — the caller already gates on its own detector for firing).
const QUESTION_RE =
  /\?\s*$|^\s*(?:so\s+|ok(?:ay)?\s+|and\s+|but\s+|well\s+|now\s+|,|\s)*(?:what|why|how|when|where|who|which|can you|could you|would you|will you|do you|did you|have you|are you|is there|tell me|walk me|describe|explain|give me|design|implement|write|reverse|find|solve|compare)\b/i

export function localClassify(questionRaw: string): LocalClassification | null {
  const q = questionRaw.trim()
  if (!q) return null

  const isQuestion = QUESTION_RE.test(q)

  // Count STRONG mode signals only. Exactly one = confident local route.
  const hits: CopilotMode[] = []
  if (BEHAVIORAL_RE.test(q)) hits.push('behavioral')
  if (CODING_RE.test(q)) hits.push('coding')
  if (SYSTEM_DESIGN_RE.test(q)) hits.push('systemDesign')

  // >1 strong signal (e.g. a genuinely mixed question) → ambiguous, let the LLM decide.
  if (hits.length > 1) return null

  if (hits.length === 1) {
    const mode = hits[0]
    // needsWeb only matters for fact-lookup modes. A behavioral/design/coding answer
    // shouldn't trigger a web search (or get a "prefer live facts" block) just because
    // it contains "recently" — that's noise + a needless ~12s hop.
    const needsWeb = mode === 'general' && WEB_RE.test(q)
    return { mode, needsWeb, isQuestion }
  }

  // No strong signal. If a WEAK token is present ("conflict", "design the", "sort the"),
  // it's genuinely ambiguous — a git-conflict question, a team-culture question — so
  // ESCALATE to the LLM rather than confidently mis-routing (the file's core invariant).
  if (WEAK_RE.test(q)) return null

  // No mode signal at all → it's a plain factual/general question. Route locally to
  // general, and honor a freshness cue there (that's exactly where web facts help).
  if (isQuestion) return { mode: 'general', needsWeb: WEB_RE.test(q), isQuestion }

  return null
}
