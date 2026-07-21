import type { TranscriptEvent } from '@/lib/transcription/types'

let SEG_SEQ = 0
// `sender` is set only in multi-party rooms: the Ably clientId that produced the
// line, so one speaker's interim never clobbers another's. Single-mic leaves it
// undefined. `name` is the speaker's Clerk display name, shown instead of
// "Speaker N" when present.
export type Segment = {
  id: number
  speaker: number | null
  text: string
  isFinal: boolean
  sender?: string
  name?: string
}

export function mergeSegments(prev: Segment[], e: TranscriptEvent): Segment[] {
  const last = prev[prev.length - 1]
  if (last && !last.isFinal) {
    // replace the trailing interim (reuse its id)
    return [...prev.slice(0, -1), { id: last.id, speaker: e.speaker, text: e.text, isFinal: e.isFinal }]
  }
  return [...prev, { id: ++SEG_SEQ, speaker: e.speaker, text: e.text, isFinal: e.isFinal }]
}

// correction track: replace a finalized segment's text in place, by id
export function applyCorrection(prev: Segment[], id: number, text: string): Segment[] {
  return prev.map((s) => (s.id === id ? { ...s, text } : s))
}

export function transcriptText(segments: Segment[]): string {
  return segments
    .filter((s) => s.isFinal)
    .map((s) => (s.speaker != null ? `Speaker ${s.speaker + 1}: ${s.text}` : s.text))
    .join('\n')
}
