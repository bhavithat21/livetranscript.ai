import type { CoachState } from '../types'
import { hashText, integer, list, object, text } from '../validation'

// Reviewed tactics, not arbitrary model-written instructions. No rule can grant
// access, change consent, rewrite observed source, or weaken evidence validation.
export const LESSONS = {
  'answer-first': { label: 'Answer first, then one next step', rule: 'Lead with the direct answer to the current question. Then name one concrete next step. Do not restate the entire problem.', categories: ['directness', 'verbosity'] },
  'inspect-once': { label: 'Inspect only the missing evidence', rule: 'Before requesting a file, check visibleView and supplied fragments. Ask for one missing method or test, not the whole repository. Do not ask for already-visible lines.', categories: ['navigation', 'stale-context'] },
  'connect-discussion': { label: 'Build on the conversation', rule: 'Acknowledge the candidate hypothesis or chosen approach in conversation when relevant. Distinguish it from verified source; do not repeat an already-discussed alternative without a concrete reason.', categories: ['directness', 'stale-context'] },
  'smallest-change': { label: 'Prefer a focused change and targeted test', rule: 'When an exact current fragment supports a fix, prefer a small patch over a rewrite. Explain the invariant and the smallest targeted regression test. Do not invent unavailable files or test results.', categories: ['correctness', 'verbosity'] },
  'tradeoffs': { label: 'State the trade-off before implementation', rule: 'For an architectural choice, compare the two most relevant options against the stated requirements. Distinguish symptom relief from resolving the underlying constraint. State assumptions rather than adding requirements.', categories: ['correctness', 'directness'] },
} as const
export type LessonId = keyof typeof LESSONS
export const SUITE = 'repository-lessons-v1'
export const CASES = ['deadline', 'minimal-change', 'candidate-claim', 'hold', 'stale-test', 'unseen-file'] as const
export const REPETITIONS = 2
export type Diagnostics = { reviewed: number; needsWork: number; failed: number; categories: string[] }
export type Comparison = { suite: string; caseId: string; repetition: number; baselineKey: string; candidateKey: string; model: string; judge: string; baselineScore: number; candidateScore: number; candidateGrounded: boolean; hardPass: boolean; baselineMs: number; candidateMs: number; note: string }
export type LearningState = { version: 1; active: LessonId[]; previous: LessonId[] | null; revision: number; history: Array<{ at: number; action: 'promoted' | 'rejected' | 'rollback'; rules: LessonId[]; reason: string }> }
export const EMPTY_LEARNING: LearningState = { version: 1, active: [], previous: null, revision: 0, history: [] }
export function lessonIds(raw: unknown): LessonId[] {
  const ids = list(raw, 4).map(value => text(value, 60, true))
  if (new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(LESSONS, id))) throw new Error('Unsupported or duplicate lesson')
  return (ids as LessonId[]).sort()
}
export const policyKey = (ids: LessonId[]) => `${SUITE}:${hashText(JSON.stringify(lessonIds(ids)))}`
export function lessonPrompt(ids: LessonId[]): string {
  return ids.length ? '\nSupplemental communication tactics (all evidence and permission rules above still apply):\n' + lessonIds(ids).map(id => LESSONS[id].rule).join('\n') : ''
}
export function diagnostics(state: CoachState): Diagnostics {
  const latest = new Map(state.feedback.map(item => [item.resultId, item]))
  const reviews = [...latest.values()]
  return { reviewed: reviews.length, needsWork: reviews.filter(item => item.verdict === 'needs-work').length, failed: state.results.filter(item => item.status === 'failed').length,
    categories: [...new Set(reviews.filter(item => item.verdict === 'needs-work').flatMap(item => item.categories))].filter(item => Object.values(LESSONS).some(lesson => (lesson.categories as readonly string[]).includes(item))).slice(0, 8) }
}
export function parseDiagnostics(raw: unknown): Diagnostics {
  const d = object(raw, ['reviewed', 'needsWork', 'failed', 'categories'])
  const reviewed = integer(d.reviewed, 0, 100), needsWork = integer(d.needsWork, 0, reviewed)
  const categories = list(d.categories, 8).map(value => text(value, 80))
  return { reviewed, needsWork, failed: integer(d.failed, 0, 100), categories }
}
export function parseComparison(raw: unknown): Comparison {
  const row = object(raw, ['suite','caseId','repetition','baselineKey','candidateKey','model','judge','baselineScore','candidateScore','candidateGrounded','hardPass','baselineMs','candidateMs','note'])
  const score = (v: unknown) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 4) throw new Error('Invalid evaluation score'); return v }
  if (typeof row.hardPass !== 'boolean' || typeof row.candidateGrounded !== 'boolean') throw new Error('Missing hard evaluation checks')
  return { suite: text(row.suite, 80), caseId: text(row.caseId, 80), repetition: integer(row.repetition, 0, 1), baselineKey: text(row.baselineKey, 100), candidateKey: text(row.candidateKey, 100), model: text(row.model, 180, true), judge: text(row.judge, 180, true), baselineScore: score(row.baselineScore), candidateScore: score(row.candidateScore), candidateGrounded: row.candidateGrounded, hardPass: row.hardPass, baselineMs: integer(row.baselineMs, 0, 60_000), candidateMs: integer(row.candidateMs, 0, 60_000), note: text(row.note, 1000) }
}
export function promotionGate(baseline: LessonId[], candidate: LessonId[], input: Comparison[]): { passed: boolean; reason: string } {
  const fail = (reason: string) => ({ passed: false, reason })
  if (policyKey(baseline) === policyKey(candidate)) return fail('No policy change to evaluate.')
  if (input.length !== CASES.length * REPETITIONS) return fail('All six scenarios need two completed paired evaluations.')
  let rows: Comparison[]
  try { rows = input.map(parseComparison) } catch { return fail('An evaluation record is malformed.') }
  const keys = new Set(rows.map(row => `${row.caseId}:${row.repetition}`))
  if (keys.size !== input.length || !CASES.every(id => [0,1].every(rep => keys.has(`${id}:${rep}`)))) return fail('A held-out scenario is missing or duplicated.')
  if (rows.some(row => row.suite !== SUITE || row.baselineKey !== policyKey(baseline) || row.candidateKey !== policyKey(candidate))) return fail('Evaluation does not match the exact proposed and active policies.')
  if (rows.some(row => !row.hardPass || !row.candidateGrounded || row.candidateScore < 3 || row.model === row.judge || /fixture|mock|synthetic/i.test(`${row.model} ${row.judge}`))) return fail('Grounding, quality, or separate-model review gate failed.')
  if (rows.some(row => row.candidateScore + .25 < row.baselineScore)) return fail('A scenario regressed; keep the current policy.')
  const average = (key: 'candidateScore' | 'baselineScore') => rows.reduce((sum, row) => sum + row[key], 0) / rows.length
  if (average('candidateScore') < average('baselineScore') + .2) return fail('Measured gain is below 0.2/4; keep the current policy.')
  const median = (key: 'candidateMs' | 'baselineMs') => rows.map(row => row[key]).sort((a,b) => a-b)[Math.floor(rows.length/2)]
  if (median('candidateMs') > median('baselineMs') * 1.2 + 750) return fail('Response time regressed beyond the permitted budget.')
  return { passed: true, reason: 'Paired held-out evaluations passed with improved judged quality and no hard-check regression. This is prompt calibration, not proof of code correctness or model training.' }
}
export function promote(state: LearningState, candidate: LessonId[], rows: Comparison[], at: number): LearningState {
  const rules = lessonIds(candidate), result = promotionGate(state.active, rules, rows)
  return { ...state, ...(result.passed ? { previous: state.active, active: rules, revision: state.revision + 1 } : {}), history: [...state.history, { at, action: result.passed ? 'promoted' as const : 'rejected' as const, rules, reason: result.reason }].slice(-20) }
}
export function rollback(state: LearningState, at: number): LearningState {
  return state.previous === null ? state : { ...state, active: state.previous, previous: null, revision: state.revision + 1, history: [...state.history, { at, action: 'rollback' as const, rules: state.previous, reason: 'Restored the previous evaluated policy.' }].slice(-20) }
}
export function parseLearning(raw: string): LearningState {
  if (raw.length > 40_000) throw new Error('Oversized lesson store')
  const s = object(JSON.parse(raw), ['version','active','previous','revision','history'])
  if (s.version !== 1) throw new Error('Unknown lesson version')
  const history = list(s.history, 20).map(value => { const h=object(value,['at','action','rules','reason']); if (!['promoted','rejected','rollback'].includes(String(h.action))) throw new Error('Invalid history'); return { at:integer(h.at),action:h.action as LearningState['history'][number]['action'],rules:lessonIds(h.rules),reason:text(h.reason,1000) } })
  return { version:1, active:lessonIds(s.active), previous:s.previous===null?null:lessonIds(s.previous),revision:integer(s.revision),history }
}
