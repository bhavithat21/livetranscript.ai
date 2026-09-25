/** Local preferences affect the next connection only; never silently restart audio. */
export type RecognitionMode = 'balanced' | 'careful'
export const RECOGNITION_KEY = 'lt.recognitionMode'
export const VOCABULARY_KEY = 'lt.customVocabulary'
export function parseRecognitionMode(raw: string): RecognitionMode {
  return JSON.parse(raw) === 'careful' ? 'careful' : 'balanced'
}
export function readRecognitionMode(): RecognitionMode {
  try { return parseRecognitionMode(localStorage.getItem(RECOGNITION_KEY) ?? '"balanced"') }
  catch { return 'balanced' }
}
export function parseVocabulary(raw: string): string {
  const value: unknown = JSON.parse(raw)
  return typeof value === 'string' ? value.slice(0, 4000) : ''
}
/** One term per line or comma. Terms are hints, not replacement rules. */
export function vocabularyTerms(value: string): string[] {
  return value.split(/[\n,]/).map(term => term.trim()).filter(Boolean)
}
/** Bound term count AND UTF-8 size. One byte is a conservative token upper bound;
 * leave room for separators under Nova-3's 500-token prompt cap. Custom terms go
 * first. Skipping an overlong term must not hide later short, useful terms. */
export function boundedKeyterms(terms: string[]): string[] {
  const seen = new Set<string>(), result: string[] = []
  let bytes = 0
  for (const raw of terms.slice(0, 500)) {
    const term = raw.trim()
    if (!term || term.length > 80 || /[\u0000-\u001f\u007f]/.test(term)) continue
    const key = term.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    const size = new TextEncoder().encode(term).length + 1
    if (bytes + size > 480) continue
    seen.add(key); result.push(term); bytes += size
    if (result.length === 100) break
  }
  return result
}
