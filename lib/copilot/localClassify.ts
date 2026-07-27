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

// Strong per-mode signals. Presence of one is high-confidence for that mode.
const BEHAVIORAL_RE =
  /\b(tell me about a time|give me an example of|describe a (?:time|situation)|a time when you|walk me through a|conflict|disagree(?:d|ment)?|failure|mistake|proud of|leadership|led a team|mentor|difficult (?:person|teammate|stakeholder)|feedback)\b/i
const CODING_RE =
  /\b(reverse a|sort (?:this|the|an|a )|implement (?:a |the )?(?:function|algorithm|method|class|stack|queue|hash ?map|linked list)|write (?:a )?(?:function|code|algorithm)|two sum|linked list|binary (?:tree|search)|palindrome|fibonacci|recursion|time complexity|big o|leetcode|debug this|refactor this|code this)\b/i
const SYSTEM_DESIGN_RE =
  /\b(design (?:a|an|the)|system design|architect(?:ure)?|scale (?:this |it |them )?(?:to|up|out|a\b)|scalab|throughput|load balanc|shard|partition|rate limiter|url shortener|news feed|distributed|microservice|high availability|caching layer)\b/i
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
  const needsWeb = WEB_RE.test(q)

  // Count strong mode signals. Exactly ONE strong signal = confident; zero or a tie
  // between modes = not confident → escalate to the LLM classifier (return null).
  const hits: CopilotMode[] = []
  if (BEHAVIORAL_RE.test(q)) hits.push('behavioral')
  if (CODING_RE.test(q)) hits.push('coding')
  if (SYSTEM_DESIGN_RE.test(q)) hits.push('systemDesign')

  if (hits.length === 1) {
    return { mode: hits[0], needsWeb, isQuestion }
  }
  // A freshness/general factual question with no technical-mode signal is confidently
  // "general" (it's the fallback bucket) — handle it locally too.
  if (hits.length === 0 && isQuestion) {
    return { mode: 'general', needsWeb, isQuestion }
  }
  // Multiple competing signals ("design a function to..." could be coding or design)
  // → ambiguous, let the LLM decide.
  return null
}
