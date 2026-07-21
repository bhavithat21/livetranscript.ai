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
