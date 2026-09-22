/** Interview contracts shared by the UI and API. No SDK or browser dependencies. */
export const FOCUSES = ['mixed', 'behavioral', 'coding', 'systemDesign'] as const
export const LEVELS = ['junior', 'mid', 'senior', 'staff'] as const
export type InterviewMode = 'live' | 'mock'
export type InterviewSettings = {
  role: string
  level: (typeof LEVELS)[number]
  focus: (typeof FOCUSES)[number]
  minutes: number
  questionCount: number
  background: string
}
export type InterviewTurn = {
  id: string
  role: 'interviewer' | 'candidate'
  text: string
  atMs: number
  source: 'typed' | 'microphone' | 'system' | 'mock'
}
export type InterviewRequest = {
  action: 'question' | 'feedback'
  mode: InterviewMode
  settings: InterviewSettings
  turns: InterviewTurn[]
}
export const DEFAULT_SETTINGS: InterviewSettings = {
  role: 'Software engineer', level: 'senior', focus: 'mixed', minutes: 30,
  questionCount: 5, background: '',
}
export const MAX_TURNS = 600
export const MAX_TRANSCRIPT_CHARS = 100_000
export const MAX_BODY_BYTES = 512_000
export const RUBRIC = {
  relevance: 'Relevance', communication: 'Clarity and structure',
  problemSolving: 'Problem solving', technicalDepth: 'Technical depth',
  ownership: 'Ownership and impact', tradeoffs: 'Trade-offs and reflection',
} as const
export type DimensionKey = keyof typeof RUBRIC
export type Evidence = { turnId: string; quote: string }
export type Dimension = {
  key: DimensionKey; score: number | null; reason: string; evidence: Evidence[]
}
export type QuestionFeedback = {
  questionId: string; score: number | null; evidence: Evidence[]
  strengths: string[]; improvements: string[]; answerOutline: string[]
}
export type InterviewFeedback = {
  version: 1; overview: string; overall: number | null
  dimensions: Dimension[]; questions: QuestionFeedback[]
  nextSteps: string[]; limitations: string[]
}
export class InterviewInputError extends Error {}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InterviewInputError('Expected an object.')
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) {
    throw new InterviewInputError(`${label} must be ${allowEmpty ? 'at most' : 'between 1 and'} ${max} characters.`)
  }
  return value.trim()
}
function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) throw new InterviewInputError(`Invalid ${label}.`)
  return value as T
}
function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new InterviewInputError(`Invalid ${label}.`)
  return value
}
export function parseInterviewRequest(value: unknown): InterviewRequest {
  const r = object(value)
  const s = object(r.settings)
  const settings: InterviewSettings = {
    role: text(s.role, 'Target role', 200),
    level: choice(s.level, LEVELS, 'level'), focus: choice(s.focus, FOCUSES, 'focus'),
    minutes: integer(s.minutes, 5, 120, 'duration'),
    questionCount: integer(s.questionCount, 1, 12, 'question count'),
    background: text(s.background, 'Background', 22_000, true),
  }
  if (!Array.isArray(r.turns) || r.turns.length > MAX_TURNS) throw new InterviewInputError(`Use at most ${MAX_TURNS} transcript turns.`)
  const ids = new Set<string>()
  let total = 0
  const turns = r.turns.map((value): InterviewTurn => {
    const t = object(value)
    const id = text(t.id, 'Turn ID', 80)
    if (ids.has(id)) throw new InterviewInputError('Transcript turn IDs must be unique.')
    ids.add(id)
    const content = text(t.text, 'Turn text', 10_000)
    total += content.length
    return {
      id, text: content,
      role: choice(t.role, ['interviewer', 'candidate'], 'speaker'),
      source: choice(t.source, ['typed', 'microphone', 'system', 'mock'], 'source'),
      atMs: integer(t.atMs, 0, 86_400_000, 'timestamp'),
    }
  })
  if (total > MAX_TRANSCRIPT_CHARS) throw new InterviewInputError('Transcript exceeds 100,000 characters. Export it and review a shorter section.')
  const mode = choice(r.mode, ['live', 'mock'], 'mode')
  const action = choice(r.action, ['question', 'feedback'], 'action')
  if (action === 'question') {
    if (mode !== 'mock') throw new InterviewInputError('Question generation is available in mock mode.')
    const questions = turns.filter((t) => t.role === 'interviewer')
    if (questions.length >= settings.questionCount) throw new InterviewInputError('The question limit has been reached. End the interview for feedback.')
    const lastQuestion = turns.findLastIndex((t) => t.role === 'interviewer')
    if (lastQuestion >= 0 && !turns.slice(lastQuestion + 1).some((t) => t.role === 'candidate')) {
      throw new InterviewInputError('Answer the current question before requesting the next one.')
    }
  } else if (!turns.some((t) => t.role === 'candidate')) {
    throw new InterviewInputError('Add or record at least one candidate answer before requesting feedback.')
  }
  return { action, mode, settings, turns }
}

const clean = (v: unknown, max = 1600): string => typeof v === 'string' ? v.trim().slice(0, max) : ''
const lines = (v: unknown, max = 5): string[] => Array.isArray(v) ? v.map((s) => clean(s, 800)).filter(Boolean).slice(0, max) : []
const normalize = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
const score = (v: unknown): number | null => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null
const asObject = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
/** Quotes must really exist in candidate answers; resumes and AI suggestions are not evidence. */
export function verifiedEvidence(value: unknown, turns: InterviewTurn[]): Evidence[] {
  if (!Array.isArray(value)) return []
  const candidates = new Map(turns.filter((t) => t.role === 'candidate').map((t) => [t.id, t.text]))
  const seen = new Set<string>()
  return value.flatMap((raw): Evidence[] => {
    const e = asObject(raw)
    const id = clean(e.turnId, 80)
    const quote = clean(e.quote, 500)
    const answer = candidates.get(id)
    const key = `${id}:${normalize(quote)}`
    if (!answer || quote.length < 12 || !normalize(answer).includes(normalize(quote)) || seen.has(key)) return []
    seen.add(key)
    return [{ turnId: id, quote }]
  }).slice(0, 3)
}
export function normalizeFeedback(value: unknown, turns: InterviewTurn[]): InterviewFeedback {
  const raw = object(value)
  if (!clean(raw.overview) || !Array.isArray(raw.dimensions)) throw new Error('The feedback service returned an incomplete report. Retry feedback.')
  const dimensions = (Object.keys(RUBRIC) as DimensionKey[]).map((key): Dimension => {
    const d = asObject((raw.dimensions as unknown[]).find((v) => asObject(v).key === key))
    const evidence = verifiedEvidence(d.evidence, turns)
    const rating = evidence.length && clean(d.reason) ? score(d.score) : null
    return { key, score: rating, evidence, reason: rating === null ? 'Not enough verified evidence to score this dimension.' : clean(d.reason) }
  })
  const byQuestion = Array.isArray(raw.questions) ? raw.questions : []
  const questions = turns.flatMap((turn, index): QuestionFeedback[] => {
    if (turn.role !== 'interviewer') return []
    const next = turns.findIndex((t, i) => i > index && t.role === 'interviewer')
    const answers = turns.slice(index + 1, next === -1 ? turns.length : next)
    const q = asObject(byQuestion.find((v) => asObject(v).questionId === turn.id))
    const evidence = verifiedEvidence(q.evidence, answers)
    return [{
      questionId: turn.id, score: evidence.length ? score(q.score) : null, evidence,
      strengths: evidence.length ? lines(q.strengths) : [],
      improvements: answers.length ? lines(q.improvements) : ['No candidate answer was captured for this question.'],
      answerOutline: lines(q.answerOutline),
    }]
  })
  const scored = dimensions.flatMap((d) => d.score === null ? [] : [d.score])
  return {
    version: 1, overview: clean(raw.overview, 2400),
    overall: scored.length >= 2 ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length * 10) / 10 : null,
    dimensions, questions, nextSteps: lines(raw.nextSteps),
    limitations: Array.from(new Set([
      'AI coaching estimate, not a hiring prediction. Scores use only captured candidate answers.',
      'Transcript-only review cannot assess vocal delivery, body language, or code execution.',
      ...(scored.length < dimensions.length ? ['Some dimensions lack verified evidence and were not scored.'] : []),
      ...lines(raw.limitations, 4),
    ])),
  }
}
export function parseMockQuestion(value: unknown, turns: InterviewTurn[]): string {
  const q = text(object(value).question, 'Question', 1600)
  if (turns.some((t) => t.role === 'interviewer' && normalize(t.text) === normalize(q))) throw new Error('The interviewer repeated a question. Retry to request a different one.')
  return q
}
export function transcriptText(turns: InterviewTurn[]): string {
  return turns.map((t) => `[${t.id}] ${formatTime(t.atMs)} ${t.role === 'candidate' ? 'Candidate' : 'Interviewer'}: ${t.text}`).join('\n\n')
}
export function formatTime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export function reportMarkdown(report: InterviewFeedback, turns: InterviewTurn[]): string {
  return [
    '# Interview feedback', report.overview,
    `Overall coaching score: ${report.overall === null ? 'Not enough evidence' : `${report.overall}/5`}`,
    '## Scorecard',
    ...report.dimensions.flatMap((d) => [
      `### ${RUBRIC[d.key]} — ${d.score === null ? 'Not assessed' : `${d.score}/5`}`, d.reason,
      ...d.evidence.map((e) => `Evidence [${e.turnId}]: “${e.quote}”`),
    ]),
    '## Question review',
    ...report.questions.flatMap((q) => [
      `### ${turns.find((t) => t.id === q.questionId)?.text ?? q.questionId}`,
      `Score: ${q.score === null ? 'Not assessed' : `${q.score}/5`}`,
      ...q.strengths.map((s) => `Strength: ${s}`), ...q.improvements.map((s) => `Improve: ${s}`),
      ...q.answerOutline.map((s) => `Practice outline: ${s}`),
      ...q.evidence.map((e) => `Evidence [${e.turnId}]: “${e.quote}”`),
    ]),
    '## Next practice steps', ...report.nextSteps.map((s) => `- ${s}`),
    '## Limitations', ...report.limitations.map((s) => `- ${s}`),
  ].join('\n\n')
}
export function savedSegments(turns: InterviewTurn[]) {
  return turns.map((t, index) => ({
    id: index + 1, speaker: t.role === 'candidate' ? 0 : 1, name: t.role === 'candidate' ? 'Candidate' : 'Interviewer',
    sender: t.role, text: t.text, isFinal: true, startMs: t.atMs, endMs: t.atMs,
  }))
}
