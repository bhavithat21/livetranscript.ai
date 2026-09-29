import type { CoachTransport } from './controller'
import type { Guidance } from './types'
import { object, text } from './validation'
import { RequestFailure, responseFailure, retryRead } from './retry'
import { retryDisplay } from './retryStatus'

/** Retry the same read-only request only before any answer has been delivered.
 * Retries stay inside the caller's original deadline and model-request budget. */
export const httpCoachTransport: CoachTransport = async (lane, context, options) => {
  const display = retryDisplay(lane)
  let delivered = false
  try {
    return await retryRead(async (signal, attempt) => {
      const response = await fetch('/api/copilot/coach', { method: 'POST', headers: { 'Content-Type': 'application/json', ...options.diagnosticHeaders, 'x-lt-attempt': String(attempt) }, body: JSON.stringify({ lane, context, instructions: options.instructions ?? '', lessons: options.lessons ?? [] }), signal })
      if (!response.ok) { void response.body?.cancel().catch(() => {}); throw responseFailure(response, `Coach unavailable (${response.status})`) }
      if (!response.body) throw new RequestFailure('Incomplete response stream', undefined, true)
      const reader = response.body.getReader(), decoder = new TextDecoder()
      const cancel = () => { void reader.cancel().catch(() => {}) }
      signal.addEventListener('abort', cancel, { once: true })
      let buffer = '', received = 0, done = false, model = '', guidance: Guidance | null = null
      try {
        signal.throwIfAborted()
        for (;;) {
          const chunk = await reader.read()
          signal.throwIfAborted()
          received += chunk.value?.byteLength ?? 0
          if (received > 250_000) throw new Error('Response budget exceeded')
          buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
          const lines = buffer.split('\n'); buffer = lines.pop() ?? ''
          if (chunk.done && buffer.trim()) { lines.push(buffer); buffer = '' }
          for (const line of lines) {
            if (!line.trim()) continue
            const event = object(JSON.parse(line))
            if (event.type === 'error') {
              const status = typeof event.status === 'number' && Number.isInteger(event.status) ? event.status : undefined
              const delay = typeof event.retryAfterMs === 'number' && Number.isFinite(event.retryAfterMs) && event.retryAfterMs >= 0 ? event.retryAfterMs : 0
              throw new RequestFailure('Model request failed', status, event.retryable === true && !delivered, delay)
            }
            if (event.type === 'delta') {
              const value = text(event.text, 8000), identity = text(event.model, 180, true)
              delivered = true
              options.delta(value, identity)
            } else if (event.type === 'done') {
              model = text(event.model, 180, true); guidance = event.guidance === null ? null : event.guidance as Guidance
              done = true; delivered = true; break
            } else if (event.type !== 'started') throw new Error('Unsupported stream event')
          }
          if (buffer.length > 120_000) throw new Error('Oversized stream event')
          if (chunk.done || done) break
        }
        if (!done) throw new RequestFailure('Incomplete response stream', undefined, !delivered)
        return { model, guidance }
      } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock() }
    }, { signal: options.signal, timeoutMs: lane === 'talk' ? 9000 : 30_000,
      canRetry: () => !delivered, beforeRetry: options.beforeRetry,
      onRetry: notice => { display.retry(notice); options.onRetry?.(notice) },
    })
  } finally { display.finish() }
}
