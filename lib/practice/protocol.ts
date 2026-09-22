import { boundedText, RepoRequestError } from '@/lib/repo/agentHttp'
import { MAX_PRACTICE_TURNS, PRACTICE_KINDS, type PracticeFeedback, type PracticeReport, type PracticeRequest, type PracticeResponse } from './types'

export function parsePracticeRequest(body: Record<string, unknown>): PracticeRequest {
  const { action, kind } = body
  if (action !== 'start' && action !== 'answer' && action !== 'report') throw new RepoRequestError('Choose a practice action')
  if (!PRACTICE_KINDS.includes(kind as typeof PRACTICE_KINDS[number])) throw new RepoRequestError('Choose a supported interview type')
  const role = boundedText(body.role, 'Target role', 120, true).trim()
  const context = boundedText(body.context, 'Context', 26_000)
  if (!Array.isArray(body.turns) || body.turns.length > MAX_PRACTICE_TURNS) throw new RepoRequestError('A practice session supports up to eight answers')
  const turns = body.turns.map((turn) => {
    if (!turn || typeof turn !== 'object' || Array.isArray(turn)) throw new RepoRequestError('Each turn needs a question and answer')
    return {
      question: boundedText(turn.question, 'Question', 1_500, true).trim(),
      answer: boundedText(turn.answer, 'Answer', 6_000, true).trim(),
    }
  })
  if (action === 'start' && turns.length) throw new RepoRequestError('Start with an empty practice session')
  if (action === 'report' && !turns.length) throw new RepoRequestError('Answer a question before requesting a review')
  if (action === 'answer' && turns.length >= MAX_PRACTICE_TURNS) throw new RepoRequestError('Finish this session or start a new practice')
  return {
    action, kind: kind as PracticeRequest['kind'], role, context, turns,
    ...(action === 'answer' ? {
      question: boundedText(body.question, 'Question', 1_500, true).trim(),
      answer: boundedText(body.answer, 'Answer', 6_000, true).trim(),
    } : {}),
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid coach response')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number, optional = false): string {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new Error('Invalid coach text')
  return value.trim()
}
function feedback(value: unknown, answer: string): PracticeFeedback {
  const result = object(value)
  if (!Array.isArray(result.rubric) || result.rubric.length < 2 || result.rubric.length > 4) throw new Error('Invalid rubric')
  return {
    summary: text(result.summary, 1_000), strength: text(result.strength, 600), nextStep: text(result.nextStep, 600),
    rubric: result.rubric.map((value) => {
      const item = object(value)
      const score = item.score
      if (score !== null && (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5)) throw new Error('Invalid rubric score')
      const evidence = text(item.evidence, 500, true)
      // A literal passage is required for any scored judgment. Never present an
      // invented quotation as evidence, even if the rest of the output is valid.
      if ((score !== null && !evidence) || (evidence && !answer.includes(evidence))) throw new Error('Unverified rubric evidence')
      return { criterion: text(item.criterion, 80), score: score as number | null, evidence, suggestion: text(item.suggestion, 700) }
    }),
  }
}
function report(value: unknown, input: PracticeRequest): PracticeReport {
  const result = object(value)
  if (!Array.isArray(result.highlights) || result.highlights.length < 1 || result.highlights.length > 5
    || !Array.isArray(result.practiceNext) || result.practiceNext.length < 1 || result.practiceNext.length > 4) throw new Error('Invalid review')
  return {
    summary: text(result.summary, 2_000), practiceNext: result.practiceNext.map((item) => text(item, 700)),
    highlights: result.highlights.map((value) => {
      const item = object(value)
      const turn = item.turn as number
      if (!Number.isInteger(turn) || turn < 1 || turn > input.turns.length) throw new Error('Invalid review reference')
      const quote = text(item.quote, 500)
      if (!input.turns[turn - 1].answer.includes(quote)) throw new Error('Unverified review evidence')
      return { turn, quote, observation: text(item.observation, 1_000) }
    }),
  }
}

export function parsePracticeResponse(raw: string, input: PracticeRequest, model: string): PracticeResponse {
  const value = object(JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')))
  if (input.action === 'report') return { model, report: report(value.report, input) }
  const last = input.action === 'answer' && input.turns.length + 1 >= MAX_PRACTICE_TURNS
  const question = last ? '' : text(value.question, 1_500)
  const focus = last ? '' : text(value.focus, 200)
  return { model, question, focus, ...(input.action === 'answer' ? { feedback: feedback(value.feedback, input.answer!) } : {}) }
}
