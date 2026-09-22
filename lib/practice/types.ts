export const PRACTICE_KINDS = ['behavioral', 'coding', 'systemDesign', 'general'] as const
export type PracticeKind = typeof PRACTICE_KINDS[number]
export const PRACTICE_LABELS: Record<PracticeKind, string> = {
  behavioral: 'Behavioral', coding: 'Coding', systemDesign: 'System design', general: 'Role knowledge',
}
export const MAX_PRACTICE_TURNS = 8

export type PracticeSettings = { role: string; kind: PracticeKind; context: string }
export type PracticeEvidence = { question: string; answer: string }
export type PracticeRequest = PracticeSettings & {
  action: 'start' | 'answer' | 'report'
  turns: PracticeEvidence[]
  question?: string
  answer?: string
}
export type PracticeRubric = {
  criterion: string
  score: number | null
  evidence: string
  suggestion: string
}
export type PracticeFeedback = {
  summary: string
  rubric: PracticeRubric[]
  strength: string
  nextStep: string
}
export type PracticeReport = {
  summary: string
  highlights: { turn: number; quote: string; observation: string }[]
  practiceNext: string[]
}
export type PracticeResponse = {
  model: string
  question?: string
  focus?: string
  feedback?: PracticeFeedback
  report?: PracticeReport
}
export type DeliveryMetrics = {
  source: 'typed' | 'microphone'
  words: number
  activeMs: number
  approximateWpm: number | null
  fillers: { phrase: string; count: number; contextual: boolean }[]
}
export type PracticeTurn = PracticeEvidence & { feedback: PracticeFeedback; metrics: DeliveryMetrics }
export type PracticeSession = PracticeSettings & {
  question: string
  focus: string
  turns: PracticeTurn[]
  phase: 'answering' | 'feedback' | 'report'
  report: PracticeReport | null
  model: string
}
