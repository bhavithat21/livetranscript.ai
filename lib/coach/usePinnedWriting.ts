import { useState } from 'react'
import type { CoachState, ResultRecord } from './types'
import { writingPresentation } from './writingPresentation'
const hasCode = (item?: ResultRecord) => !!item?.guidance?.draft || !!item?.guidance?.patches.length

export function usePinnedWriting(state: CoachState) {
  const candidate = writingPresentation(state)
  const key = `${state.sessionId}:${state.question?.id ?? ''}`
  const [pinned, setPinned] = useState<{ key: string; result?: ResultRecord }>({ key, result: candidate })
  // A guarded render adjustment resets only for a new question, or latches the
  // first complete code. Screen edits and background replacements cannot move it.
  let displayed = pinned.result
  if (pinned.key !== key || (!hasCode(pinned.result) && hasCode(candidate))) {
    displayed = candidate
    setPinned({ key, result: candidate })
  }
  return {
    result: hasCode(displayed) ? displayed : candidate,
    updateAvailable: hasCode(candidate) && candidate?.id !== displayed?.id,
    acceptUpdate: () => { if (hasCode(candidate)) setPinned({ key, result: candidate }) },
  }
}
