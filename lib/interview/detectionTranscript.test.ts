import { describe, expect, it } from 'vitest'
import { detectionTranscript } from './detectionTranscript'
import { latestQuestionGroup } from '@/lib/copilot/useProactive'
const row = (text: string, capturedAt: number, isFinal = true) => ({ id: capturedAt, text, capturedAt, isFinal, speaker: null })
describe('live question turn boundaries', () => {
  it('keeps multipart interviewer questions together', () => {
    expect(latestQuestionGroup(detectionTranscript([row('How would you scale this?', 1), row('What are the tradeoffs?', 1000)], []))).toBe('How would you scale this? What are the tradeoffs?')
  })
  it('does not combine unrelated questions across a candidate answer', () => {
    const text = detectionTranscript([row('How would you scale this?', 1), row('Tell me about a disagreement', 5000)], [row('Why not use this other system?', 2000)])
    expect(latestQuestionGroup(text)).toBe('Tell me about a disagreement')
    expect(text).not.toContain('Why not use')
  })
  it('separates long gaps without a candidate channel and excludes interim hypotheses', () => {
    expect(latestQuestionGroup(detectionTranscript([row('How would you scale this?', 1), row('What about retries?', 60000), row('How does this work?', 61000, false)], []))).toBe('What about retries?')
  })
})
