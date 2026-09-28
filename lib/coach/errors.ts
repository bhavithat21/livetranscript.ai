export const COACH_ERRORS = {
  timeout: 'Analysis timed out. Narrow the visible code or retry when ready.',
  provider: 'The model service could not finish this request. Retry when ready.',
  format: 'The model returned an incomplete analysis. Retry with a smaller visible section.',
  evidence: 'The proposed change could not be matched to the observed code. Capture a clear view with line numbers, then retry.',
  budget: 'The model reached its output limit. Narrow the question or visible code, then retry.',
  rate: 'The request limit was reached. Wait briefly before retrying.',
  configuration: 'This model is unavailable. Check the configured model and provider access.',
} as const
export type CoachErrorCode = keyof typeof COACH_ERRORS
export class CoachRequestError extends Error {
  constructor(readonly code: CoachErrorCode) { super(COACH_ERRORS[code]) }
}
export function coachErrorCode(value: unknown): CoachErrorCode { return typeof value === 'string' && Object.hasOwn(COACH_ERRORS, value) ? value as CoachErrorCode : 'provider' }
