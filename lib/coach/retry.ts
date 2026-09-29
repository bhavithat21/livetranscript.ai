/** Retries are opt-in for read-only AI requests, never writes or capture prompts.
 * One owner, three total attempts, one deadline, no replay after visible output. */
export type RetryNotice = { attempt: number; maxAttempts: number; delayMs: number; status?: number }
export class RequestFailure extends Error {
  constructor(message: string, public status?: number, public retryable = false, public retryAfterMs = 0) { super(message) }
}
const TRANSIENT = new Set([408, 429, 500, 502, 503, 504, 529])
export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (!value || value.length > 128) return 0
  if (/^\d+$/.test(value.trim())) {
    const milliseconds = Number(value.trim()) * 1000
    return Number.isFinite(milliseconds) ? milliseconds : Number.MAX_SAFE_INTEGER
  }
  if (!/^[A-Za-z]{3}, /.test(value)) return 0
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - now) : 0
}
export function failurePolicy(error: unknown): { retryable: boolean; status?: number; retryAfterMs: number } {
  if (error instanceof RequestFailure) return { retryable: error.retryable, status: error.status, retryAfterMs: error.retryAfterMs }
  try {
    if (!error || typeof error !== 'object') return { retryable: false, retryAfterMs: 0 }
    const e = error as { name?: unknown; message?: unknown; status?: unknown; headers?: unknown }
    const name = typeof e.name === 'string' ? e.name : ''
    if (name === 'AbortError' || name === 'NotAllowedError' || name === 'SecurityError') return { retryable: false, retryAfterMs: 0 }
    const status = typeof e.status === 'number' && Number.isInteger(e.status) ? e.status : undefined
    let retryAfterMs = 0
    if (e.headers && typeof e.headers === 'object') {
      const headers = e.headers as { get?: (key: string) => string | null; 'retry-after'?: unknown }
      const value = typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after']
      if (typeof value === 'string') retryAfterMs = parseRetryAfter(value)
    }
    if (status !== undefined) return { retryable: TRANSIENT.has(status), status, retryAfterMs }
    const network = name === 'APIConnectionError' || name === 'APIConnectionTimeoutError'
      || (name === 'TypeError' && typeof e.message === 'string' && /fetch|network|load failed/i.test(e.message))
    return { retryable: network, retryAfterMs: 0 }
  } catch { return { retryable: false, retryAfterMs: 0 } }
}
export function responseFailure(response: Response, message: string): RequestFailure {
  return new RequestFailure(message, response.status,
    response.headers.get('x-lt-retryable') !== 'false' && TRANSIENT.has(response.status),
    parseRetryAfter(response.headers.get('retry-after')))
}
export function retryHeaders(error: unknown, stop = false): Record<string, string> {
  const policy = failurePolicy(error)
  return { 'x-lt-retryable': String(!stop && policy.retryable),
    ...(policy.retryAfterMs > 0 ? { 'Retry-After': String(Math.ceil(policy.retryAfterMs / 1000)) } : {}) }
}
function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => { cleanup(); reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')) }
    const cleanup = () => signal.removeEventListener('abort', aborted)
    signal.addEventListener('abort', aborted, { once: true })
    work.then(value => { cleanup(); signal.aborted ? aborted() : resolve(value) }, error => { cleanup(); reject(error) })
    if (signal.aborted) aborted()
  })
}
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => { clearTimeout(timer); signal.removeEventListener('abort', aborted); reject(signal.reason) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', aborted); resolve() }, milliseconds)
    signal.addEventListener('abort', aborted, { once: true })
    if (signal.aborted) aborted()
  })
}
export async function retryRead<T>(operation: (signal: AbortSignal, attempt: number) => Promise<T>, options: {
  signal: AbortSignal; timeoutMs: number; maxAttempts?: number;
  canRetry?: () => boolean; beforeRetry?: () => boolean; onRetry?: (notice: RetryNotice) => void;
  random?: () => number;
}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3 || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid retry budget')
  const controller = new AbortController(), deadline = Date.now() + options.timeoutMs
  const abort = () => controller.abort(options.signal.reason)
  options.signal.addEventListener('abort', abort, { once: true })
  if (options.signal.aborted) abort()
  const timer = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded', 'TimeoutError')), options.timeoutMs)
  try {
    for (let attempt = 1; ; attempt++) {
      controller.signal.throwIfAborted()
      try { return await abortable(operation(controller.signal, attempt), controller.signal) }
      catch (error) {
        controller.signal.throwIfAborted()
        const policy = failurePolicy(error)
        if (!policy.retryable || attempt >= maxAttempts || options.canRetry?.() === false) throw error
        const random = options.random?.() ?? Math.random()
        const jitter = Number.isFinite(random) ? Math.max(0, Math.min(1, random)) : 0.5
        const delayMs = Math.max(policy.retryAfterMs, Math.round(500 * 2 ** (attempt - 1) * (0.75 + jitter * 0.5)))
        if (delayMs + 250 >= deadline - Date.now()) throw error
        try { options.onRetry?.({ attempt: attempt + 1, maxAttempts, delayMs, status: policy.status }) } catch { /* UI/telemetry cannot change execution */ }
        await wait(delayMs, controller.signal)
        controller.signal.throwIfAborted()
        if (options.canRetry?.() === false || options.beforeRetry?.() === false) throw error
      }
    }
  } finally {
    clearTimeout(timer); options.signal.removeEventListener('abort', abort)
  }
}
