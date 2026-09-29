import { resultCurrent } from './state'
import type { CoachState, ResultRecord } from './types'

/** Display continuity only. Retained proposals never become current evidence. */
export function writingPresentation(state: CoachState): ResultRecord | undefined {
  const eligible = (item: ResultRecord) => item.lane !== 'talk' && item.questionId === state.question?.id
    && item.taskVersion === state.task.version && !!item.guidance
    && (item.status === 'complete' || item.status === 'stale')
  const current = state.results.findLast(item => eligible(item) && item.status === 'complete' && resultCurrent(item, state))
  const hasCode = (item: ResultRecord) => !!item.guidance?.draft || !!item.guidance?.patches.length
  if (current && hasCode(current)) return current
  return state.results.findLast(item => eligible(item) && hasCode(item)) ?? current
}
