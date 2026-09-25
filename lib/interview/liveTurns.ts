import type { CapturedSegment } from './useInterviewRecorder'
export type ChannelSegment = CapturedSegment & { channel: 'call' | 'mic' }
export type LiveTurn = { key: string; channel: 'call' | 'mic'; speaker: number | null; capturedAt: number; parts: ChannelSegment[] }

/** Merge consecutive chunks for display, never across voices/channels, stream
 * restarts or long pauses. All recognized words and interim flags are retained. */
export function liveTurns(rows: ChannelSegment[]): LiveTurn[] {
  const out: LiveTurn[] = []
  for (const row of [...rows].sort((a, b) => a.capturedAt - b.capturedAt || (a.channel === b.channel ? (a.startMs ?? 0) - (b.startMs ?? 0) : 0))) {
    if (!row.text.trim()) continue
    const turn = out.at(-1), previous = turn?.parts.at(-1)
    const stream = (value?: string) => value?.split(':')[0]
    const sameStream = stream(previous?.utteranceId) === stream(row.utteranceId)
    const gap = sameStream && previous?.endMs != null && row.startMs != null ? row.startMs - previous.endMs : row.capturedAt - (previous?.capturedAt ?? row.capturedAt)
    const size = turn?.parts.reduce((n, part) => n + part.text.length + 1, 0) ?? 0
    if (!turn || turn.channel !== row.channel || turn.speaker !== row.speaker || !sameStream || gap > 8000 || gap < -1000 || (size > 650 && /[.!?]$/.test(previous?.text.trim() ?? ''))) {
      out.push({key:`${row.channel}-${row.id}`,channel:row.channel,speaker:row.speaker,capturedAt:row.capturedAt,parts:[row]})
    } else turn.parts.push(row)
  }
  return out
}
export function voiceLabel(channel: 'call' | 'mic', speaker: number | null, interviewer: number | null = null): string {
  if (channel === 'mic') return speaker == null ? 'Microphone · Voice pending' : `Microphone · Speaker ${speaker + 1}`
  if (speaker == null) return 'Call · Voice pending'
  return `${speaker === interviewer ? 'Interviewer' : 'Call'} · Speaker ${speaker + 1}`
}
