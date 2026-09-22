import type { CapturedSegment } from './useInterviewRecorder'

// Keep question groups within a speaker turn. Candidate words are not questions
// for the assistant, but removing the turn entirely joins unrelated questions.
export function detectionTranscript(call: CapturedSegment[], candidate: CapturedSegment[]): string {
  const rows = [
    ...call.filter((row) => row.isFinal).map((row) => ({ ...row, candidate: false })),
    ...candidate.filter((row) => row.isFinal).map((row) => ({ ...row, candidate: true })),
  ].sort((a, b) => a.capturedAt - b.capturedAt)
  let previous = 0
  return rows.flatMap((row, index) => {
    const boundary = index > 0 && row.capturedAt - previous > 15_000 ? ['Turn boundary.'] : []
    previous = row.capturedAt
    const text = row.candidate ? 'Candidate response.' : row.text.trim()
    return [...boundary, /[.!?]$/.test(text) ? text : `${text}.`]
  }).join('\n')
}
