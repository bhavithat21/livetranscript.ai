import { buildContext } from '../../lib/coach/context'
import { emptyCoach, reduceCoach } from '../../lib/coach/state'
import type { EventPayload } from '../../lib/coach/types'

export const ROUND_CASES = ['acknowledged-job-failure', 'worker-deadline', 'stale-callback-view', 'ambiguous-plan-item'] as const
/** Authored reproductions of observed failure modes. Rubrics never enter model context. */
export function roundCase(id: string) {
  let state = emptyCoach('round-eval'), serial = 0
  const emit = (payload: EventPayload) => { state = reduceCoach(state, { ...payload, sessionId: state.sessionId, id: `e${++serial}`, at: serial * 1000 }) }
  emit({ type: 'session.start', permission: 'practice', objective: 'The report calculation must take ten seconds. Prevent the client request from timing out.' })
  emit({ type: 'speech.final', speaker: 'interviewer', text: 'The report calculation has to take ten seconds. We cannot remove or speed up that work.' })
  emit({ type: 'dialogue.update', turn: { sourceId: 'goal', at: 1, role: 'interviewer', text: 'We need to acknowledge the request immediately and let the report finish in the background.' } })
  emit({ type: 'dialogue.update', turn: { sourceId: 'design', at: 2, role: 'candidate', text: 'I would persist a queued job, return its job ID, and expose success or failure in a separate status request.' } })
  // The plan is outside the rolling conversation by the follow-up.
  for (let at = 3; at <= 28; at++) emit({ type: 'dialogue.update', turn: { sourceId: `filler-${at}`, at, role: 'candidate', text: 'That example is clear.' } })
  let question: string, rubric: string
  if (id === 'acknowledged-job-failure') {
    question = 'What belongs in the background worker catch block, and how does the client find out?'
    rubric = 'Preserve acknowledged job ID/status design. Record failed job state and a safe cause; client checks separate status or agreed notification. Never send onError/onNext through the completed acknowledgment observer. Retry only transient failures with bounded attempts and idempotency. Do not claim persistence is already implemented.'
  } else if (id === 'worker-deadline') {
    question = 'If we put the report in CompletableFuture and send the response when it finishes, does that prevent the deadline?'
    rubric = 'Answer no: returning from the handler frees execution but does not complete an RPC; response after ten seconds still faces the deadline. Immediate ack with durable job/status is a contract change, not merely a thread change. Do not assume CompletableFuture is durable or bounded; do not recommend keepalive as a deadline fix.'
  } else if (id === 'stale-callback-view') {
    emit({ type: 'screen.observed', origin: 'replay', capturedAt: 1, observation: { files: [{ path: 'src/ReportService.java', language: 'java', startLine: 40, lines: ['Report result = generator.run(id);'], confidence: 1, endOfFile: false }], visiblePaths: [], terminal: '', requirements: [] } })
    emit({ type: 'screen.status', freshness: { status: 'error', capturedAt: 1 } })
    emit({ type: 'dialogue.update', turn: { sourceId: 'edit', at: 30, role: 'candidate', text: 'I changed that to a future with a completion callback.' } })
    question = 'How should I handle errors in the callback I just added?'
    rubric = 'Give conceptual error handling consistent with job acknowledgment, but do not claim the callback is absent, still unwritten, or currently synchronous from old code. Candidate edit is reported, not visually verified. Request a fresh callback view only for exact edit details; do not replace the answer with a screen request.'
  } else if (id === 'ambiguous-plan-item') {
    question = 'Is that the one you mean?'
    rubric = 'Ask one brief clarification about the referent (plan item versus visible method). Do not confidently pick a method or code location without supporting dialogue or fresh evidence. Avoid a generic framework list.'
  } else throw new Error('Unknown round case')
  emit({ type: 'question.new', original: question, text: question })
  return { lane: 'talk' as const, context: buildContext(state, 10000), rubric }
}
