/** Diagnostics are metadata, never a general-purpose log sink. Both boundaries
 * rebuild from allowlists. Do not add messages, stacks, URLs, paths or content. */
export const STAGES = ['app', 'audio', 'transcription', 'screen', 'screen_model', 'talk', 'guide', 'review'] as const
export const EVENTS = ['start', 'ready', 'first_frame', 'first_partial', 'first_final', 'first_token', 'heartbeat', 'success', 'error', 'cancelled', 'stop', 'paused', 'stall', 'feedback', 'offline', 'online', 'upload_test'] as const
export const CODES = ['permission_denied', 'unavailable', 'network', 'timeout', 'cancelled', 'unauthorized', 'rate_limited', 'provider_unavailable', 'invalid_json', 'invalid_path', 'invalid_language', 'invalid_lines', 'invalid_confidence', 'invalid_shape', 'incomplete_stream', 'unknown'] as const
export type Stage = typeof STAGES[number]
export type DiagnosticEventName = typeof EVENTS[number]
export type DiagnosticCode = typeof CODES[number]
export type Attributes = Record<string, string | number | boolean>
export type DiagnosticEvent = { v: 1; sessionId: string; operationId: string; seq: number; at: number; stage: Stage; event: DiagnosticEventName; attrs: Attributes }
export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const NUMBERS = new Set(['durationMs', 'firstTokenMs', 'frames', 'bytes', 'partials', 'finals', 'count', 'attempts', 'dropped', 'sampleAgeMs', 'captureAgeMs', 'evidenceAgeMs'])
const ENUMS: Record<string, readonly string[]> = {
  code: CODES, channel: ['mic', 'system'], source: ['browser', 'native'], runtime: ['web', 'desktop'],
  phase: ['idle', 'starting', 'recording', 'stopping'], gate: ['initial', 'changed', 'unchanged', 'settling', 'throttled', 'busy'],
  category: ['correctness', 'directness', 'navigation', 'stale-context', 'latency', 'verbosity'], verdict: ['pass', 'needs-work'],
  provider: ['openai', 'anthropic', 'groq', 'gemini', 'deepgram', 'assemblyai'],
}
export function sanitizeAttributes(input: unknown): Attributes {
  const result: Attributes = {}
  if (!input || typeof input !== 'object' || Array.isArray(input)) return result
  for (const [key, value] of Object.entries(input)) {
    if (NUMBERS.has(key) && typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000) result[key] = Math.round(value)
    else if (key === 'httpStatus' && Number.isInteger(value) && Number(value) >= 100 && Number(value) <= 599) result[key] = Number(value)
    else if ((key === 'speechDetected' || key === 'hasFrames') && typeof value === 'boolean') result[key] = value
    else if (Object.hasOwn(ENUMS, key) && typeof value === 'string' && ENUMS[key].includes(value)) result[key] = value
    else if (key === 'release' && typeof value === 'string' && /^[a-f0-9]{7,40}$/i.test(value)) result[key] = value
    else if (key === 'desktopVersion' && typeof value === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-[a-z0-9.-]{1,20})?$/i.test(value)) result[key] = value
    else if (key === 'model' && typeof value === 'string' && /^(?:claude-|gpt-|o[134](?:-|$)|gemini-|llama-|qwen|moonshotai\/|meta-llama\/|openai\/)[a-zA-Z0-9._:/-]{0,90}$/.test(value)) result[key] = value
  }
  return result
}
export function parseDiagnosticEvent(value: unknown): DiagnosticEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid diagnostic event')
  const item = value as Record<string, unknown>
  const keys = ['v', 'sessionId', 'operationId', 'seq', 'at', 'stage', 'event', 'attrs']
  if (Object.keys(item).length !== keys.length || keys.some(key => !Object.hasOwn(item, key)) || item.v !== 1
    || typeof item.sessionId !== 'string' || !UUID.test(item.sessionId) || typeof item.operationId !== 'string' || !UUID.test(item.operationId)
    || !Number.isSafeInteger(item.seq) || Number(item.seq) < 1 || Number(item.seq) > 10_000_000
    || !Number.isSafeInteger(item.at) || Number(item.at) < 0 || Number(item.at) > 10_000_000_000_000
    || !STAGES.includes(item.stage as Stage) || !EVENTS.includes(item.event as DiagnosticEventName)) throw new Error('Invalid diagnostic event')
  const attrs = sanitizeAttributes(item.attrs)
  if (!item.attrs || typeof item.attrs !== 'object' || Array.isArray(item.attrs)
    || Object.keys(item.attrs).length !== Object.keys(attrs).length) throw new Error('Invalid diagnostic attributes')
  return { v: 1, sessionId: item.sessionId, operationId: item.operationId, seq: Number(item.seq), at: Number(item.at), stage: item.stage as Stage, event: item.event as DiagnosticEventName, attrs }
}
export function diagnosticCode(error: unknown, status?: number): DiagnosticCode {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 429) return 'rate_limited'
  if (status === 404 || status === 503) return 'provider_unavailable'
  // DOMException and cross-webview errors need not inherit this realm's Error.
  // Read only bounded name/message for categorization, never serialize either.
  let message = '', name = ''
  try {
    if (typeof error === 'string') message = error.slice(0, 2048)
    else if (error && typeof error === 'object') {
      const value = error as { name?: unknown; message?: unknown }
      if (typeof value.name === 'string') name = value.name.slice(0, 80)
      if (typeof value.message === 'string') message = value.message.slice(0, 2048)
    }
  } catch { return 'unknown' }
  if (/denied|notallowed|permission/i.test(name + ' ' + message)) return 'permission_denied'
  if (/timed?\s*out|timeout/i.test(name + ' ' + message)) return 'timeout'
  if (name === 'AbortError' || /cancelled|canceled/i.test(message)) return 'cancelled'
  if (/network|failed to fetch|connection|websocket/i.test(message)) return 'network'
  if (/json/i.test(message)) return 'invalid_json'
  if (/incomplete|before completion|no answer/i.test(message)) return 'incomplete_stream'
  if (/evidence|invalid|schema/i.test(message)) return 'invalid_shape'
  if (/unavailable|not found|unknown command/i.test(message)) return 'unavailable'
  return 'unknown'
}
