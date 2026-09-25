import type { Segment } from './store'

/** Room sender is a stable identity; single-stream ASR uses its diarization label. */
export function sameSpeaker(a: Segment, b: Segment): boolean {
  return a.sender != null || b.sender != null ? a.sender === b.sender : a.speaker === b.speaker
}
export type ReadingBlock = { key: number; first: Segment; paragraphs: Segment[][] }
/** Presentation only. Never changes, deletes, corrects or persists spoken words.
 * Reset time and paragraph budgets per block (not at the start of a monologue).
 * Real source changes, long gaps and clock resets establish new reading blocks. */
export function readingBlocks(segments: Segment[]): ReadingBlock[] {
  const blocks: ReadingBlock[] = []
  let chars = 0, paragraphChars = 0, previous: Segment | undefined
  for (const segment of segments) {
    if (!segment.text.trim()) continue
    const current = blocks.at(-1)
    const gap = previous?.endMs != null && segment.startMs != null ? segment.startMs - previous.endMs : 0
    const age = current?.first.startMs != null && segment.startMs != null ? segment.startMs - current.first.startMs : 0
    const boundary = !current || !previous || !sameSpeaker(previous, segment) || gap >= 12_000 || gap < -1000
      || (age >= 45_000 && chars >= 180) || chars >= 1400
    if (boundary) {
      blocks.push({ key: segment.id, first: segment, paragraphs: [[segment]] })
      chars = segment.text.length; paragraphChars = chars
    } else {
      const breakParagraph = (gap >= 2500 && paragraphChars >= 120) || paragraphChars >= 700
        || (paragraphChars >= 420 && /[.!?]["’”']?$/.test(previous?.text.trim() ?? ''))
      if (breakParagraph) { current.paragraphs.push([]); paragraphChars = 0 }
      current.paragraphs.at(-1)!.push(segment)
      chars += segment.text.length + 1; paragraphChars += segment.text.length + 1
    }
    previous = segment
  }
  return blocks
}
export function transcriptTime(ms?: number): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null
  const seconds = Math.floor(ms / 1000)
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
}
