export const SCREEN_ERRORS = {
  timeout: 'Reading the screen timed out. Zoom in on the relevant method, then capture again.',
  provider: 'The screen-reading service could not finish. Capture again when ready.',
  format: 'The screen text could not be read reliably. Zoom in and include line numbers, then capture again.',
  budget: 'There is too much visible text. Show a smaller section, then capture again.',
  configuration: 'Screen reading is not configured for this deployment.',
  rate: 'Screen reading reached its request limit. Wait briefly, then capture again.',
  unauthorized: 'Sign in again to resume screen reading.',
  cancelled: 'Screen reading stopped.',
} as const
export type ScreenErrorCode = keyof typeof SCREEN_ERRORS
export const screenErrorCode = (value: unknown): ScreenErrorCode => typeof value === 'string' && Object.hasOwn(SCREEN_ERRORS, value) ? value as ScreenErrorCode : 'provider'
export class ScreenReadError extends Error {
  constructor(readonly code: ScreenErrorCode) { super(SCREEN_ERRORS[code]) }
}
