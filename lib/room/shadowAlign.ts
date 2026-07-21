// Voice-driven follow-along alignment. The repeater already has a live ASR
// stream; we align what they've said so far against the source text to find
// which word they're currently on — no extra model call, just a greedy
// suffix-tolerant match so small mis-recognitions or skipped words don't lose
// the place. Returns the count of source words covered = the active word index.

function norm(w: string): string {
  return w.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// How many source words ahead we'll scan for a match — tolerates the repeater
// skipping or the ASR dropping a word or two without derailing the cursor.
const SKIP_WINDOW = 3

export function alignIndex(sourceWords: string[], spokenText: string): number {
  const src = sourceWords.map(norm)
  const spoken = spokenText.split(/\s+/).map(norm).filter(Boolean)
  if (spoken.length === 0 || src.length === 0) return 0

  let pos = 0
  for (const word of spoken) {
    if (pos >= src.length) break
    for (let k = 0; k < SKIP_WINDOW && pos + k < src.length; k++) {
      if (src[pos + k] === word) {
        pos = pos + k + 1
        break
      }
    }
  }
  return Math.min(pos, src.length)
}

// ── Adaptive highlight band ──────────────────────────────────────────────────
// The band ("what to read next") should cover a consistent amount of SPEAKING
// TIME, not a fixed word count — otherwise filler-heavy text over-highlights and
// dense text under-highlights. We estimate speaking time by syllables (pure local
// math, zero latency) and light words ahead until we've covered ~a breath-sized
// phrase, clamped to a sensible word range so it never looks like a blob.

// Rough syllable estimate: count vowel groups, drop a silent trailing 'e'. Good
// enough to pace the highlight; it never needs to be linguistically exact.
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (!w) return 1
  const groups = w.match(/[aeiouy]+/g)
  let n = groups ? groups.length : 1
  if (w.length > 2 && w.endsWith('e') && !w.endsWith('le')) n -= 1
  return Math.max(1, n)
}

// ~1.5s of shadowed speech ≈ 6 syllables at a deliberate repeating pace.
const TARGET_BAND_SYLLABLES = 6
const MIN_BAND_WORDS = 2
const MAX_BAND_WORDS = 6

// How many words to highlight AHEAD of the lead word so the band spans roughly
// TARGET_BAND_SYLLABLES of speech, clamped to [MIN,MAX] words.
export function bandWordCount(
  words: string[],
  from: number,
  targetSyllables = TARGET_BAND_SYLLABLES,
): number {
  let syl = 0
  let count = 0
  for (let i = from; i < words.length && count < MAX_BAND_WORDS; i++) {
    syl += syllables(words[i])
    count++
    if (count >= MIN_BAND_WORDS && syl >= targetSyllables) break
  }
  return Math.max(MIN_BAND_WORDS, count)
}

// Which visual band a word falls in, given where the reader is (activeIndex) and
// how many words the "read next" band spans. Pure so it's unit-testable:
//   covered  — behind the reader: the growing marked trail ("continues/increases")
//   lead     — the exact word being said now
//   band     — the next few words to read
//   upcoming — further ahead (speaker already said it), shown faint
export type ShadowWordState = 'covered' | 'lead' | 'band' | 'upcoming'
export function wordState(i: number, activeIndex: number, bandWords: number): ShadowWordState {
  if (i === activeIndex) return 'lead'
  if (i > activeIndex && i < activeIndex + bandWords) return 'band'
  if (i < activeIndex) return 'covered'
  return 'upcoming'
}

// Salient words from the source line, fed to the reader's ASR as keyterms so it
// recognizes exactly the words being read (biggest accuracy win, zero per-word
// latency — keyterms are sent once at connection). Skips short/function words,
// dedupes, caps so it can merge under the provider's 100-term budget.
export function sourceKeyterms(source: string, cap = 60): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of source.split(/\s+/)) {
    const w = raw.replace(/[^A-Za-z0-9'-]/g, '')
    if (w.length < 4) continue
    const key = w.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(w)
    if (out.length >= cap) break
  }
  return out
}
