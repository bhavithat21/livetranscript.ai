import type { TranscriptEvent } from '@/lib/transcription/types'

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

// Pure: the new id is derived from the list (max + 1), so ids restart at 1 for a
// fresh session with no global counter to bleed across recordings or survive Fast
// Refresh. Matches mergeRoomSegments. Returns `prev` UNCHANGED when the incoming
// interim is identical to the trailing one (ASR re-emits these ~10x/sec) so React
// skips the re-render and we don't copy the whole history for a no-op.
export function mergeSegments(prev: Segment[], e: TranscriptEvent): Segment[] {
  const last = prev[prev.length - 1]
  if (last && !last.isFinal) {
    if (last.text === e.text && last.isFinal === e.isFinal && last.speaker === e.speaker) return prev
    // replace the trailing interim (reuse its id)
    return [...prev.slice(0, -1), { id: last.id, speaker: e.speaker, text: e.text, isFinal: e.isFinal }]
  }
  const nextId = prev.reduce((max, s) => Math.max(max, s.id), 0) + 1
  return [...prev, { id: nextId, speaker: e.speaker, text: e.text, isFinal: e.isFinal }]
}

// Coerce untrusted input (the client-sent segments blob) into clean Segment[]
// before it's persisted. Drops anything malformed and caps text length, so a
// hand-crafted request body can't store arbitrary shapes/oversized payloads in
// the DB — defense in depth even though React escapes on render.
const MAX_SEG_TEXT = 10_000
export function sanitizeSegments(input: unknown): Segment[] {
  if (!Array.isArray(input)) return []
  const out: Segment[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    if (typeof r.text !== 'string') continue
    out.push({
      id: typeof r.id === 'number' && Number.isFinite(r.id) ? r.id : out.length + 1,
      speaker: typeof r.speaker === 'number' ? r.speaker : null,
      text: r.text.slice(0, MAX_SEG_TEXT),
      isFinal: r.isFinal === true,
      ...(typeof r.sender === 'string' ? { sender: r.sender.slice(0, 200) } : {}),
      ...(typeof r.name === 'string' ? { name: r.name.slice(0, 200) } : {}),
    })
  }
  return out
}

// correction track: replace a finalized segment's text in place, by id
export function applyCorrection(prev: Segment[], id: number, text: string): Segment[] {
  return prev.map((s) => (s.id === id ? { ...s, text } : s))
}

// Split a line into sentences so the transcript reads as one statement per line
// (easier to follow, and to repeat/shadow) instead of a run-on block. Splits on
// whitespace that follows . ! or ? — so decimals like "3.14" stay intact since
// they have no following space. Falls back to the whole trimmed string.
export function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  return trimmed.split(/(?<=[.!?])\s+/).filter(Boolean)
}

export function transcriptText(segments: Segment[]): string {
  return segments
    .filter((s) => s.isFinal)
    .map((s) => (s.speaker != null ? `Speaker ${s.speaker + 1}: ${s.text}` : s.text))
    .join('\n')
}
