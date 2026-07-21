import type { Segment } from '@/lib/transcript/store'
import type { RoomMessage, RoomRole } from './useRoom'

// Reader -> Speaker 1 (index 0), Repeater -> Speaker 2 (index 1). Fixed by role,
// so no diarization: each machine is one known person.
export function roleToSpeaker(role: RoomRole): number {
  return role === 'reader' ? 0 : 1
}

let ROOM_SEQ = 0

// Two independent streams interleave. Unlike the single-mic store, we replace the
// trailing INTERIM of the SAME role — a reader interim must not clobber a repeater interim.
export function mergeRoomSegments(prev: Segment[], m: RoomMessage): Segment[] {
  const speaker = roleToSpeaker(m.role)
  // find the last segment for this role
  for (let i = prev.length - 1; i >= 0; i--) {
    if (prev[i].speaker === speaker) {
      if (!prev[i].isFinal) {
        const next = prev.slice()
        next[i] = { ...prev[i], text: m.text, isFinal: m.isFinal }
        return next
      }
      break // last for this role is final -> append a new one
    }
  }
  return [...prev, { id: ++ROOM_SEQ, speaker, text: m.text, isFinal: m.isFinal }]
}
