import type { InterviewSession } from './session'

export const MAX_CALIBRATION = 1500
export type TuningProfile = { revision: number; instructions: string; updatedAt: number }
export type TuningState = { version: 1; active: TuningProfile; previous: TuningProfile | null }
export const EMPTY_TUNING: TuningState = { version: 1, active: { revision: 0, instructions: '', updatedAt: 0 }, previous: null }
export type CopilotObservation = {
  id: string; question: string; mode: string; answer: string; transcript: string
  instructions: string; calibration: string; revision: number
  firstTokenMs: number | null; totalMs: number; status: 'complete' | 'error'; error?: string
  hasImage: boolean
}
export type TuningRun = CopilotObservation & { expected: string; verdict: 'unreviewed' | 'pass' | 'needs-work'; notes: string }

export function tuningKey(owner: string): string { return `lt.interview.tuning.v1.${encodeURIComponent(owner)}` }
function isProfile(value: unknown): value is TuningProfile {
  if (!value || typeof value !== 'object') return false
  const p = value as Record<string, unknown>
  return typeof p.revision === 'number' && Number.isSafeInteger(p.revision) && p.revision >= 0 &&
    typeof p.instructions === 'string' && p.instructions.length <= MAX_CALIBRATION &&
    typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) && p.updatedAt >= 0
}
export function parseTuning(raw: string): TuningState {
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Invalid tuning profile')
  const v = value as Record<string, unknown>
  if (v.version !== 1 || !isProfile(v.active) || (v.previous !== null && !isProfile(v.previous))) throw new Error('Invalid tuning profile')
  return { version: 1, active: v.active, previous: v.previous }
}
export function publishTuning(state: TuningState, instructions: string, now: number): TuningState {
  if (instructions.length > MAX_CALIBRATION) throw new Error('Calibration is too long')
  return { version: 1, previous: state.active, active: { revision: state.active.revision + 1, instructions, updatedAt: now } }
}
export function rollbackTuning(state: TuningState, now: number): TuningState {
  return state.previous ? publishTuning(state, state.previous.instructions, now) : state
}
export function hasAcceptedRun(runs: TuningRun[], instructions: string): boolean {
  return runs.some((r) => r.status === 'complete' && r.answer.trim() && r.verdict === 'pass' && r.calibration === instructions)
}
export function tuningSession(runs: TuningRun[], startedAt: number): InterviewSession {
  const transcript = runs.slice(-20).map((r, i) => [
    `## System test ${i + 1} (${r.mode})`,
    `Result: ${r.status}; human review: ${r.verdict}; live profile revision at test: ${r.revision}`,
    `Question: ${r.question.slice(0, 2000)}`,
    `Scenario transcript${r.transcript.length > 5000 ? ' (last 5000 characters only)' : ''}: ${r.transcript.slice(-5000)}`,
    `Calibration tested: ${r.calibration}`,
    `Expected behavior / reference (held out from generation): ${r.expected.slice(0, 2000) || 'Not supplied'}`,
    `AI COPILOT OUTPUT (not a candidate answer):\n${r.answer.slice(0, 12000)}${r.answer.length > 12000 ? '\n[Output truncated in report.]' : ''}`,
    `Client-measured first token: ${r.firstTokenMs === null ? 'not observed' : Math.round(r.firstTokenMs) + ' ms'}; completion: ${Math.round(r.totalMs)} ms. This excludes speech recognition and pre-request orchestration.`,
    `Human notes: ${r.notes.slice(0, 2000) || 'None'}`,
    `Image attached: ${r.hasImage}; image bytes are not retained in this report.`,
    r.error ? `Request error: ${r.error}` : '',
  ].filter(Boolean).join('\n\n')).join('\n\n---\n\n')
  return {
    id: crypto.randomUUID(), kind: 'tuning', title: 'Live copilot tuning report', createdAt: startedAt,
    durationSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)), transcript, turns: [],
    captureNote: 'SYSTEM CALIBRATION SESSION. Evaluate AI copilot responses, not the candidate. Mock uses the live CopilotPanel and /api/copilot/answer path. Human verdicts are subjective test annotations, not validated scores. No code execution, hiring prediction, or model-weight training is established by this report. Scenario excerpts and output truncation are labeled. Test records do not capture every retrieval document, chat-history item, or screen frame.',
  }
}
