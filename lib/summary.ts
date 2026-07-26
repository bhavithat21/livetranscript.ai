// The shape a stored/returned meeting summary must have. Both sources are
// untrusted — the LLM's JSON response and the client-sent save payload — so both
// are coerced through here before they reach the DB or the session detail page
// (which renders summary.summary and maps over keyPoints/actionItems as strings).
export type StoredSummary = { summary: string; keyPoints: string[]; actionItems: string[] }

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Returns a well-formed summary, or null when there's no usable summary text.
export function normalizeSummary(input: unknown): StoredSummary | null {
  if (!input || typeof input !== 'object') return null
  const s = input as Record<string, unknown>
  if (typeof s.summary !== 'string') return null
  return { summary: s.summary, keyPoints: stringArray(s.keyPoints), actionItems: stringArray(s.actionItems) }
}
