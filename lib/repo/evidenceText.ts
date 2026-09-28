/** Remove recognizable video-page chrome, never invent a missing requirement. */
export function taskRequirements(values: string[]): string[] {
  const normalized = [...new Set(values.map(value => value.trim().replace(/^>\s*/, '')).filter(value => value
    && !/\b(?:ace your interviews|interview prep course|in this video|subscribe to|like and subscribe|sponsored by)\b|\.\.\.more$/i.test(value)
    && !/^\d[\d.,]*\s*[KMB]?\s+views\b/i.test(value)
    && !/(?:\.\.\.|…)\s*$/.test(value)))]
  // A clipped recapture must not become a second requirement or evict its full text.
  return normalized.filter(value => value.length < 40 || !normalized.some(other => other.length > value.length && other.startsWith(value)))
}

/** Idle shell prompts and editor status bars are not command output. */
export function terminalEvidence(value: string): string {
  return value.split('\n').filter(line => !/^\s*[\w.-]+@[\w.-]+(?:[^\n]*?)[$%#>]\s*$/.test(line)
    && !/^\s*Ln \d+, Col \d+\s+Spaces:/i.test(line)).join('\n').trim()
}
