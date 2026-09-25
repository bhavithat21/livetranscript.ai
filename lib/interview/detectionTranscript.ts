import type { CapturedSegment } from './useInterviewRecorder'

/** Do not fabricate sentence-final punctuation for ASR fragments. Join source
 * chunks within a voice turn; delimit actual speaker/channel changes and pauses.
 * Roles are supplied explicitly, never inferred from the numeric voice label. */
export function detectionTranscript(call: CapturedSegment[], candidate: CapturedSegment[], interviewer: number | null = null): string {
  const rows = [
    ...call.filter(row => row.isFinal).map(row => ({ ...row, candidate: interviewer != null && row.speaker !== interviewer })),
    ...candidate.filter(row => row.isFinal).map(row => ({ ...row, candidate: true })),
  ].sort((a, b) => a.capturedAt - b.capturedAt || (a.startMs ?? 0) - (b.startMs ?? 0))
  const turns: string[] = []
  let group: string[] = [], previous: typeof rows[number] | undefined
  const flush = (closed = false) => {
    if (!group.length) return
    const text = group.join(' ')
    // A real voice/channel boundary closes a turn, not each ASR packet.
    turns.push(closed && !/[.!?]$/.test(text) ? `${text}.` : text)
    group = []
  }
  for (const row of rows) {
    const boundary = previous && (previous.candidate !== row.candidate || previous.speaker !== row.speaker || row.capturedAt - previous.capturedAt > 15000)
    if (boundary) { flush(true); turns.push('Turn boundary.') }
    if (row.candidate) { flush(); if (!previous?.candidate) turns.push('Candidate response.') }
    else if (row.text.trim()) group.push(row.text.trim())
    previous = row
  }
  flush()
  return turns.join('\n')
}
