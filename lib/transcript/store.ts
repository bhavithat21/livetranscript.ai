import type { TranscriptEvent } from '@/lib/transcription/types'

// `sender` is set only in multi-party rooms: the Ably clientId that produced the
// line, so one speaker's interim never clobbers another's. Single-mic leaves it
// undefined. `name` is the speaker's Clerk display name, shown instead of
// "Speaker N" when present. `startMs`/`endMs` come from the ASR provider and are
// relative to that sender's OWN stream — only ever compare them between segments
// from the same sender, never across senders or a provider reconnect.
export type Segment = {
  id: number
  speaker: number | null
  text: string
  isFinal: boolean
  sender?: string
  name?: string
  startMs?: number
  endMs?: number
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
    // replace the trailing interim (reuse its id, and its startMs — an interim's
    // start is stable while its end keeps advancing as more words arrive)
    return [
      ...prev.slice(0, -1),
      { id: last.id, speaker: e.speaker, text: e.text, isFinal: e.isFinal, startMs: last.startMs ?? e.startMs, endMs: e.endMs },
    ]
  }
  const nextId = prev.reduce((max, s) => Math.max(max, s.id), 0) + 1
  return [...prev, { id: nextId, speaker: e.speaker, text: e.text, isFinal: e.isFinal, startMs: e.startMs, endMs: e.endMs }]
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
      ...(typeof r.startMs === 'number' && Number.isFinite(r.startMs) ? { startMs: r.startMs } : {}),
      ...(typeof r.endMs === 'number' && Number.isFinite(r.endMs) ? { endMs: r.endMs } : {}),
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

// A speaker who talks for a minute straight produces dozens of ASR segments that,
// joined, render as one unreadable wall. Break that turn into paragraphs the way a
// listener hears it: at a real pause in speech, and before any one block grows too
// long to scan.
const PARAGRAPH_GAP_MS = 2000
const PARAGRAPH_MAX_CHARS = 320

export type Paragraph = {
  key: string
  segments: Segment[]
  text: string
  isFinal: boolean
  // False when this paragraph carries the overflow of a segment too long to fit
  // the character cap. TranscriptView keys paragraph spacing off segment ids, so
  // it needs to tell a real break from a mid-segment continuation.
  startsSegment: boolean
}

// Break one segment's text into pieces that each fit the cap. Prefers sentence
// boundaries; falls back to word boundaries for a single sentence that is itself
// over the cap. A single word longer than the cap is left intact — truncating
// mid-word would corrupt the transcript, and CSS wraps it anyway.
function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text]
  const out: string[] = []
  let cur = ''
  const push = () => {
    if (cur) out.push(cur)
    cur = ''
  }
  const add = (piece: string) => {
    if (cur && cur.length + 1 + piece.length > max) push()
    cur = cur ? `${cur} ${piece}` : piece
  }
  for (const sentence of splitSentences(text)) {
    if (sentence.length > max) {
      push()
      for (const word of sentence.split(/\s+/)) add(word)
      continue
    }
    add(sentence)
  }
  push()
  return out.length ? out : [text]
}

// Split ONE speaker's consecutive segments into paragraphs. Breaks where speech
// paused for >= PARAGRAPH_GAP_MS, and hard-caps every paragraph at
// PARAGRAPH_MAX_CHARS so no single block can grow into a wall — including when
// one ASR segment alone runs past the cap. Timings are stream-relative per
// sender, so a provider reconnect can rewind the clock — a negative gap is
// treated as "no pause" (running text is a better failure than a spurious break).
export function paragraphize(segments: Segment[]): Paragraph[] {
  const out: Paragraph[] = []
  for (const s of segments) {
    chunkText(s.text.trim(), PARAGRAPH_MAX_CHARS).forEach((chunk, ci) => {
      const cur = out[out.length - 1]
      const prev = cur?.segments[cur.segments.length - 1]
      const gap = prev?.endMs != null && s.startMs != null ? s.startMs - prev.endMs : 0
      const tooLong = cur ? cur.text.length + 1 + chunk.length > PARAGRAPH_MAX_CHARS : false
      // ci > 0 is overflow from a segment that already filled a paragraph.
      if (!cur || ci > 0 || gap >= PARAGRAPH_GAP_MS || tooLong) {
        out.push({
          key: ci === 0 ? String(s.id) : `${s.id}-${ci}`,
          segments: [s],
          text: chunk,
          isFinal: s.isFinal,
          startsSegment: ci === 0,
        })
      } else {
        cur.segments.push(s)
        cur.text = cur.text ? `${cur.text} ${chunk}` : chunk
        cur.isFinal = cur.isFinal && s.isFinal
      }
    })
  }
  return out
}

export function transcriptText(segments: Segment[]): string {
  return segments
    .filter((s) => s.isFinal)
    .map((s) => (s.speaker != null ? `Speaker ${s.speaker + 1}: ${s.text}` : s.text))
    .join('\n')
}
