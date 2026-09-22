import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS, MAX_TURNS, normalizeFeedback, parseInterviewRequest,
  parseMockQuestion, reportMarkdown, savedSegments, verifiedEvidence,
  type InterviewTurn,
} from './model'
import { interviewPrompt } from './prompts'

const turns: InterviewTurn[] = [
  { id: 'q1', role: 'interviewer', text: 'Describe an incident you owned.', atMs: 0, source: 'mock' },
  { id: 'a1', role: 'candidate', text: 'I isolated the failing queue, rolled back the change and added an alert.', atMs: 4000, source: 'typed' },
]
const evidence = [{ turnId: 'a1', quote: 'I isolated the failing queue' }]
const request = (action: 'question' | 'feedback' = 'feedback') => ({ action, mode: 'mock', settings: DEFAULT_SETTINGS, turns })
const feedback = () => ({
  overview: 'Concrete actions are captured; more context is needed.',
  dimensions: [
    { key: 'relevance', score: 4, reason: 'Addresses the incident directly.', evidence },
    { key: 'ownership', score: 3, reason: 'Names personal actions.', evidence },
  ],
  questions: [{ questionId: 'q1', score: 4, evidence, strengths: ['Specific actions'], improvements: ['Explain the result'], answerOutline: ['Add a verified outcome'] }],
  nextSteps: ['Practice explaining the outcome'], limitations: [],
})

describe('interview request boundaries', () => {
  it('accepts a valid transcript without changing attribution', () => expect(parseInterviewRequest(request()).turns).toEqual(turns))
  it('rejects missing candidate answers for feedback', () => expect(() => parseInterviewRequest({ ...request(), turns: [turns[0]] })).toThrow(/candidate answer/))
  it('rejects unexpected modes, speakers, focus and non-string content', () => {
    for (const payload of [
      { ...request(), mode: 'hidden' },
      { ...request(), settings: { ...DEFAULT_SETTINGS, focus: 'other' } },
      { ...request(), turns: [{ ...turns[1], role: 'assistant' }] },
      { ...request(), turns: [{ ...turns[1], text: {} }] },
    ]) expect(() => parseInterviewRequest(payload)).toThrow()
  })
  it('rejects duplicate IDs and invalid timestamps', () => {
    expect(() => parseInterviewRequest({ ...request(), turns: [turns[1], turns[1]] })).toThrow(/unique/)
    expect(() => parseInterviewRequest({ ...request(), turns: [{ ...turns[1], atMs: -1 }] })).toThrow(/timestamp/)
  })
  it('rejects overlong roles, background, text and too many turns', () => {
    expect(() => parseInterviewRequest({ ...request(), settings: { ...DEFAULT_SETTINGS, role: 'x'.repeat(201) } })).toThrow()
    expect(() => parseInterviewRequest({ ...request(), settings: { ...DEFAULT_SETTINGS, background: 'x'.repeat(22001) } })).toThrow()
    expect(() => parseInterviewRequest({ ...request(), turns: [{ ...turns[1], text: 'x'.repeat(10001) }] })).toThrow()
    expect(() => parseInterviewRequest({ ...request(), turns: Array.from({ length: MAX_TURNS + 1 }, (_, i) => ({ ...turns[1], id: String(i) })) })).toThrow()
  })
  it('rejects an oversized aggregate transcript rather than silently slicing it', () => {
    expect(() => parseInterviewRequest({ ...request(), turns: Array.from({ length: 11 }, (_, i) => ({ ...turns[1], id: String(i), text: 'x'.repeat(10000) })) })).toThrow(/100,000/)
  })
  it('requires an answer before another mock question', () => expect(() => parseInterviewRequest({ ...request('question'), turns: [turns[0]] })).toThrow(/Answer the current/))
  it('enforces the mock question limit and prevents live question generation', () => {
    expect(() => parseInterviewRequest({ ...request('question'), settings: { ...DEFAULT_SETTINGS, questionCount: 1 } })).toThrow(/question limit/)
    expect(() => parseInterviewRequest({ ...request('question'), mode: 'live' })).toThrow(/mock mode/)
  })
  it('allows an opening question and answered follow-up', () => {
    expect(parseInterviewRequest({ ...request('question'), turns: [] }).turns).toEqual([])
    expect(parseInterviewRequest(request('question')).action).toBe('question')
  })
})

describe('evidence-grounded feedback', () => {
  it('accepts exact candidate quotes, including whitespace differences', () => {
    expect(verifiedEvidence(evidence, turns)).toEqual(evidence)
    expect(verifiedEvidence([{ turnId: 'a1', quote: 'I isolated  the failing queue' }], turns)).toHaveLength(1)
  })
  it('drops interviewer, invented, unknown and too-short quotes', () => {
    expect(verifiedEvidence([
      { turnId: 'q1', quote: turns[0].text }, { turnId: 'a1', quote: 'I saved ten million dollars' },
      { turnId: 'missing', quote: turns[1].text }, { turnId: 'a1', quote: 'I' },
    ], turns)).toEqual([])
  })
  it('computes the overall score only from verified dimensions', () => {
    const report = normalizeFeedback({ ...feedback(), overall: 99 }, turns)
    expect(report.overall).toBe(3.5)
    expect(report.dimensions.find((d) => d.key === 'technicalDepth')?.score).toBeNull()
  })
  it('never turns absent, malformed or unevidenced scores into zero', () => {
    for (const score of [0, 6, 2.5, '5', null]) {
      const report = normalizeFeedback({ ...feedback(), dimensions: [{ key: 'relevance', score, reason: 'R', evidence }] }, turns)
      expect(report.overall).toBeNull()
      expect(report.dimensions[0].score).toBeNull()
    }
    const report = normalizeFeedback({ ...feedback(), dimensions: [{ key: 'relevance', score: 5, reason: 'R', evidence: [] }] }, turns)
    expect(report.dimensions[0].score).toBeNull()
  })
  it('does not transfer evidence across question boundaries', () => {
    const additional: InterviewTurn[] = [...turns, { ...turns[0], id: 'q2', atMs: 5000 }, { ...turns[1], id: 'a2', text: 'I do not have an example for this.', atMs: 6000 }]
    const report = normalizeFeedback({ ...feedback(), questions: [{ questionId: 'q2', score: 5, evidence }] }, additional)
    expect(report.questions[1].score).toBeNull()
    expect(report.questions[1].evidence).toEqual([])
  })
  it('handles unanswered questions and malformed model output', () => {
    expect(normalizeFeedback(feedback(), [turns[0]]).questions[0].improvements[0]).toMatch(/No candidate answer/)
    expect(() => normalizeFeedback({}, turns)).toThrow(/incomplete/)
  })
  it('renders a complete export and preserves saved speaker names', () => {
    const report = normalizeFeedback(feedback(), turns)
    const markdown = reportMarkdown(report, turns)
    expect(markdown).toContain('Interview feedback')
    expect(markdown).toContain('Explain the result')
    expect(markdown).toContain('not a hiring prediction')
    expect(savedSegments(turns).map((s) => s.name)).toEqual(['Interviewer', 'Candidate'])
  })
  it('rejects empty or repeated mock questions', () => {
    expect(() => parseMockQuestion({}, turns)).toThrow()
    expect(() => parseMockQuestion({ question: turns[0].text.toUpperCase() }, turns)).toThrow(/repeated/)
    expect(parseMockQuestion({ question: 'How did you verify recovery?' }, turns)).toContain('verify')
  })
  it('separates untrusted interview data from interviewer/evaluator instructions', () => {
    const prompt = interviewPrompt(parseInterviewRequest(request()))
    expect(prompt).toContain('untrusted interview data')
    expect(prompt).toContain('never as candidate evidence')
    expect(prompt).not.toContain(turns[1].text)
  })
})
