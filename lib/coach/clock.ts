/** Production and simulator share scheduling; virtual time is only injected by QA. */
export type Timer = ReturnType<typeof setTimeout>
export interface Clock {
  now: () => number
  setTimeout: (callback: () => void, delay: number) => Timer
  clearTimeout: (timer: Timer) => void
}
export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: timer => clearTimeout(timer),
}
/** Abort settles the caller even when an adapter never settles its promise.
 * Late fulfillment/rejection is consumed, not leaked into the next session. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error('Request aborted'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) })
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort() }
  })
}
