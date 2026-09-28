/** A tree can prepend one display-root label to the qualified editor path.
 * Resolve navigation only; never combine code fragments or bare basenames.
 * More than one matching qualified tree path leaves the identity ambiguous. */
export function observedPathAlias(path: string, observedPaths: string[], knownPaths: string[]): string | null {
  if (observedPaths.includes(path)) return null
  const suffix = path.split('/').slice(1).join('/')
  if (suffix.split('/').length < 3 || !observedPaths.includes(suffix)) return null
  const matches = [...new Set(knownPaths)].filter(item => item.endsWith(`/${suffix}`))
  return matches.length === 1 && matches[0] === path ? suffix : null
}
