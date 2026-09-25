import { describe, it, expect } from 'vitest'
import { questionCandidates, incompleteQuestion } from './questionDetection'
import { detectionTranscript } from '@/lib/interview/detectionTranscript'
const row = (text: string, n: number, speaker: number | null = 0, isFinal = true) => ({ id:n, text, speaker, isFinal, capturedAt:n*1000 })
describe('hands-free interview detection — synthetic text, not audio recognition', () => {
  it.each(['How does that sound?', 'Can you hear me?', 'Are you ready?', 'Does that make sense?', 'Today we are doing a technical interview.', 'You are allowed to use an AI coding agent.'])('does not answer setup/logistics: %s', text => expect(questionCandidates(text)).toHaveLength(0))
  it.each(['Can you', 'How would you design.', 'Tell me about the.', 'What is', 'Please explain.'])('does not bill an incomplete stem: %s', text => { expect(incompleteQuestion(text)).toBe(true); expect(questionCandidates(text)).toHaveLength(0) })
  it('joins unfinished provider chunks rather than manufacturing a separate prompt per packet', () => {
    const text = detectionTranscript([row('How would you', 1), row('make report generation',2), row('asynchronous?',3)], [])
    expect(text).toBe('How would you make report generation asynchronous?')
    expect(questionCandidates(text).at(-1)?.question).toBe(text)
  })
  it('ignores nonfinal guesses and keeps candidate speech out of the prompt', () => {
    const text = detectionTranscript([row('How would you fix the timeout?',1), row('Where are the tests?',4,0,false)], [row('Why not guess?',2)])
    expect(text).not.toContain('guess'); expect(text).not.toContain('tests')
    expect(questionCandidates(text).at(-1)?.question).toBe('How would you fix the timeout?')
  })
  it('does not glue questions across real voice boundaries', () => {
    const text = detectionTranscript([row('Explain the request path',1,0),row('How would you handle retries?',2,1)], [])
    expect(questionCandidates(text).at(-1)?.question).toBe('How would you handle retries?')
  })
  it('does not assume who the interviewer is from the speaker number', () => {
    const rows = [row('What is the failure?',1,1),row('How would you test this?',2,0)]
    expect(questionCandidates(detectionTranscript(rows,[])).at(-1)?.question).toBe('How would you test this?')
    expect(questionCandidates(detectionTranscript(rows,[],1)).at(-1)?.question).toBe('What is the failure?')
  })
  it('gives a repeated question a new occurrence only after another turn', () => {
    const q='How would you handle retries?'
    const all=questionCandidates(`${q} Candidate response. ${q}`)
    expect(all).toHaveLength(2); expect(all[0].key).not.toBe(all[1].key)
  })
  it('punctuation and casing revisions keep the same occurrence key', () => {
    expect(questionCandidates('Explain the status endpoint.')[0].key).toBe(questionCandidates('explain the status endpoint?')[0].key)
  })
  it('captures implementation instructions without requiring a question mark', () => {
    for (const text of ['Please implement polling for the report status.', 'Refactor the service to enqueue a background job.', "I'd like you to add a regression test."]) expect(questionCandidates(text).at(-1)?.question).toBe(text)
  })
})

it('keeps a question key when earlier unrelated speech is reformatted or role-filtered', () => {
  const question = 'How would you handle cancellation?'
  expect(questionCandidates('We discussed the first task. Candidate response. ' + question).at(-1)?.key)
    .toBe(questionCandidates('Candidate response. ' + question).at(-1)?.key)
})
