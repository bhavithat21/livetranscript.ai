import type { CoachState } from './types'
import { redactSecrets } from './validation'

/** Bounded opt-in comparison record, separate from candidate speech. No images,
 * raw audio or unseen source. Never reimport this as code evidence. */
export function roundReview(state: CoachState): string {
  const records = state.questions.map(question => ({
    question: question.text, detectedAt: question.at,
    responses: state.results.filter(result => result.questionId === question.id).map(result => ({
      lane: result.lane, status: result.status, model: result.model, codeVersion: result.codeVersion,
      taskVersion: result.taskVersion, evidenceVersion: result.evidenceVersion,
      requestAt: result.startedAt, firstTextMs: result.firstUsefulMs, totalMs: result.totalMs,
      answer: result.text, guidance: result.guidance, error: result.error,
    })),
  }))
  const source = JSON.stringify({
    type: 'copilot-comparison-record', coverage: 'Captured excerpt only. At most 80 questions and 80 responses retained. Not a full-round completion claim.',
    latency: 'Request-to-first-text and completion only; excludes audio recognition and detection.',
    records, currentConstraints: state.task.constraints, currentPatchReviews: state.patchReviews,
    observedTests: state.tests.map(({ command, status, codeVersion, passed, failed, sourceId }) => ({ command, status, codeVersion, passed, failed, sourceId })),
    humanAnnotations: state.feedback,
  }, (_key, value) => typeof value === 'string' ? redactSecrets(value) : value, 2)
  if (source.length <= 40_000) return source
  // Do not cut JSON into an apparently valid complete record.
  return `Partial comparison record; middle omitted. Do not infer missing responses.\n${source.slice(0, 19_000)}\n[Comparison records omitted]\n${source.slice(-19_000)}`
}

export function comparisonExcerpt(transcript: string, record: string) {
  const excerpt = (value: string, limit: number) => value.length <= limit ? value : `${value.slice(0, limit / 2 - 50)}\n[Middle omitted; no inference allowed]\n${value.slice(-limit / 2 + 50)}`
  return { transcript: `CAPTURED HUMAN DIALOGUE\n${excerpt(transcript, 21_000)}\n\nAI COPILOT RECORDS — NOT CANDIDATE SPEECH\n${excerpt(record, 18_000)}`,
    coverage: 'Paired review of captured dialogue and separately labelled copilot records. Large inputs are excerpted. Missing code, responses, or the end of the recording are coverage gaps, not candidate failures. Request timing excludes speech recognition.' }
}
