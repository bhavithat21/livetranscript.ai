import type { Segment } from '@/lib/transcript/store'
import type { RoomMessage } from './useRoom'
import { isFriendlyRoomId } from './roomId'

// A meeting seats up to five speakers (color slots 0–4). Extra participants can
// still join and watch, but don't get a mic slot.
export const MAX_SPEAKERS = 5

// N independent streams interleave, one per participant. We replace the trailing
// INTERIM belonging to the SAME sender — so speaker A's live words never clobber
// speaker B's. A different sender (or a finalized same-sender line) appends.
// Pure: the new id is derived from the list (max + 1), so there's no global
// counter to bleed ids across rooms or survive Fast Refresh.
export function mergeRoomSegments(prev: Segment[], m: RoomMessage): Segment[] {
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].sender === m.sender) {
      if (!prev[i].isFinal) {
        // Identical re-emit of this sender's interim → no-op, skip the copy + re-render.
        if (prev[i].text === m.text && prev[i].isFinal === m.isFinal && prev[i].speaker === m.speaker) {
          return prev
        }
        const next = prev.slice()
        // Keep the interim's original startMs — only its end advances as words land.
        next[i] = { ...prev[i], speaker: m.speaker, text: m.text, isFinal: m.isFinal, startMs: prev[i].startMs ?? m.startMs, endMs: m.endMs }
        return next
      }
      break // last line for this sender is final → append a new one
    }
  }
  const nextId = prev.reduce((max, s) => Math.max(max, s.id), 0) + 1
  return [
    ...prev,
    { id: nextId, speaker: m.speaker, text: m.text, isFinal: m.isFinal, sender: m.sender, name: m.name, startMs: m.startMs, endMs: m.endMs },
  ]
}

// Deterministically assign a speaker slot (0–4) from the sorted roster of client
// ids, so every participant independently computes the SAME color for each person.
// Returns -1 for anyone beyond the 5-seat cap (listener, no mic slot).
export function speakerSlot(clientId: string, roster: string[]): number {
  const idx = [...roster].sort().indexOf(clientId)
  return idx >= 0 && idx < MAX_SPEAKERS ? idx : -1
}

// Color slot for each sender, computed on the RECEIVER from the senders actually
// present in the transcript (sorted for determinism). Every client sees the same
// set of senders → agrees on colors, regardless of the sender-computed `speaker`
// field on the wire (which races the roster and was showing everyone one color).
export function colorMap(segments: Segment[]): Map<string, number> {
  const senders = [...new Set(segments.map((s) => s.sender).filter(Boolean) as string[])].sort()
  const map = new Map<string, number>()
  senders.forEach((sender, i) => map.set(sender, i % MAX_SPEAKERS))
  return map
}

// The color slot to render for one segment: prefer the receiver-derived map
// (consistent across clients); fall back to the wire `speaker` for single-mic.
export function segmentSlot(seg: Segment, colors: Map<string, number>): number {
  if (seg.sender && colors.has(seg.sender)) return colors.get(seg.sender)!
  return seg.speaker ?? 0
}

// Minimum entropy for a meeting id: matches what newRoomId() produces (12
// base64url chars from 9 random bytes ≈ 72 bits). Rejecting shorter / low-variety
// ids (e.g. "testmeeting", "standup") stops URL enumeration of active rooms —
// legitimate meetings are always reached via a shared random link.
const ROOM_ID_MIN_LEN = 12

export function isStrongRoomId(id: string): boolean {
  // Friendly word-word-#### ids are the primary shape now (10M+ combos, ephemeral).
  if (isFriendlyRoomId(id)) return true
  // Legacy base64url ids stay valid so previously-shared links keep working.
  if (id.length < ROOM_ID_MIN_LEN) return false
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return false
  if (!/[A-Z0-9]/.test(id)) return false
  return new Set(id).size >= 8
}
