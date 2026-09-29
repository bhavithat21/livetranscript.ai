'use client'
import { diagnosticCode, parseDiagnosticEvent, sanitizeAttributes, type DiagnosticEvent, type DiagnosticEventName, type Stage } from './schema'
import { installCoachDiagnostics } from '../coach/diagnostics'

const STORE = 'lt.diagnostics.v1', ENABLED = 'lt.diagnostics.enabled.v1'
const MAX_EVENTS = 600, MAX_PENDING = 100, TTL = 24 * 60 * 60 * 1000
export type DiagnosticsSnapshot = { enabled: boolean; sessionId: string; events: readonly DiagnosticEvent[]; pending: number; dropped: number; delivery: 'idle' | 'sending' | 'sent' | 'failed' | 'local-only'; lastSentAt: number | null }
const EMPTY: DiagnosticsSnapshot = { enabled: true, sessionId: '', events: [], pending: 0, dropped: 0, delivery: 'idle', lastSentAt: null }
let state = EMPTY, initialized = false, seq = 0, pending: DiagnosticEvent[] = [], timer: ReturnType<typeof setTimeout> | null = null
let sending: Promise<boolean> | null = null, request: AbortController | null = null, epoch = 0, retryMs = 5000
const listeners = new Set<() => void>()
function publish(next: Partial<DiagnosticsSnapshot>) { state = { ...state, ...next }; for (const fn of listeners) { try { fn() } catch { /* UI cannot break capture */ } } }
function persist() { try { localStorage.setItem(STORE, JSON.stringify(state.events.filter(item => Date.now() - item.at < TTL).slice(-MAX_EVENTS))) } catch { /* storage may be unavailable */ } }
function newId() { try { return crypto.randomUUID() } catch { return '' } }
export function initializeDiagnostics(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  let enabled = true
  const events: DiagnosticEvent[] = []
  try {
    enabled = localStorage.getItem(ENABLED) !== 'false'
    const raw = localStorage.getItem(STORE)
    if (raw && raw.length < 700_000) {
      const stored: unknown = JSON.parse(raw)
      if (Array.isArray(stored)) for (const item of stored.slice(-MAX_EVENTS)) {
        try { const event = parseDiagnosticEvent(item); if (event.at <= Date.now() && Date.now() - event.at < TTL) events.push(event) } catch { /* corrupt entries are not trusted */ }
      }
    }
  } catch { /* continue in memory */ }
  const sessionId = newId()
  publish({ enabled: enabled && !!sessionId, sessionId, events: enabled ? events : [] })
  installCoachDiagnostics({ span: diagnosticSpan, record: recordDiagnostic, code: diagnosticCode })
  persist()
}
export const subscribeDiagnostics = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export const getDiagnostics = () => state
export const getServerDiagnostics = () => EMPTY
function schedule() {
  if (timer || !pending.length || !state.enabled || sending) return
  timer = setTimeout(() => { timer = null; void flushDiagnostics() }, retryMs)
}
export function recordDiagnostic(stage: Stage, event: DiagnosticEventName, attrs: unknown = {}, operationId?: string): void {
  try {
    if (!initialized || !state.enabled) return
    const entry = parseDiagnosticEvent({ v: 1, sessionId: state.sessionId, operationId: operationId || newId(), seq: ++seq, at: Date.now(), stage, event, attrs: sanitizeAttributes(attrs) })
    pending.push(entry)
    let dropped = state.dropped
    if (pending.length > MAX_PENDING) { pending.shift(); dropped++ }
    publish({ events: [...state.events.filter(item => Date.now() - item.at < TTL), entry].slice(-MAX_EVENTS), pending: pending.length, dropped })
    persist(); schedule()
  } catch { /* telemetry must NEVER affect application behavior */ }
}
export function diagnosticSpan(stage: Stage, attrs: unknown = {}) {
  const started = Date.now(), operationId = newId(), context = sanitizeAttributes(attrs), sessionId = state.sessionId, token = epoch
  let ended = false
  const valid = () => !ended && token === epoch && sessionId === state.sessionId
  recordDiagnostic(stage, 'start', context, operationId)
  return {
    id: operationId,
    headers(): Record<string, string> { return initialized && state.enabled && operationId && valid() ? { 'x-lt-session-id': sessionId, 'x-lt-operation-id': operationId } : {} },
    event(event: DiagnosticEventName, more: unknown = {}) { if (valid()) recordDiagnostic(stage, event, { ...context, ...sanitizeAttributes(more), durationMs: Date.now() - started }, operationId) },
    end(event: 'success' | 'error' | 'cancelled' | 'stop', more: unknown = {}) { if (!valid()) return; ended = true; recordDiagnostic(stage, event, { ...context, ...sanitizeAttributes(more), durationMs: Date.now() - started }, operationId) },
    failure(error: unknown, status?: number) { if (!valid()) return; ended = true; const code = diagnosticCode(error, status); recordDiagnostic(stage, code === 'cancelled' ? 'cancelled' : 'error', { ...context, code, httpStatus: status, durationMs: Date.now() - started }, operationId) },
  }
}
export function setDiagnosticsEnabled(enabled: boolean) {
  initializeDiagnostics(); epoch++; request?.abort(); request = null
  if (timer) clearTimeout(timer)
  timer = null; pending = []
  try { localStorage.setItem(ENABLED, String(enabled)); if (!enabled) localStorage.removeItem(STORE) } catch { /* best effort */ }
  publish({ enabled, pending: 0, events: enabled ? state.events : [], delivery: enabled ? 'idle' : 'local-only' })
}
export function clearDiagnostics() {
  initializeDiagnostics(); epoch++; request?.abort()
  if (timer) clearTimeout(timer)
  timer = null; pending = []; seq = 0
  publish({ events: [], sessionId: newId(), pending: 0, dropped: 0, lastSentAt: null, delivery: 'idle' }); persist()
}
export function exportDiagnostics(): string {
  initializeDiagnostics()
  return JSON.stringify({ format: 'livetranscript-diagnostics-v1', exportedAt: new Date().toISOString(), sessionId: state.sessionId, dropped: state.dropped, delivery: state.delivery,
    note: 'Metadata only. Client times and events are diagnostic observations, not proof of OS permissions, transcript accuracy or successful user outcomes. Retained locally for at most 24 hours and 600 events.',
    events: state.events.filter(item => Date.now() - item.at < TTL).map(parseDiagnosticEvent) }, null, 2)
}
export function flushDiagnostics(): Promise<boolean> {
  initializeDiagnostics()
  if (sending) return sending
  if (!state.enabled || !pending.length || typeof window === 'undefined') return Promise.resolve(false)
  if (timer) clearTimeout(timer)
  timer = null
  const batch = pending.slice(0, 25), token = epoch, controller = new AbortController()
  request = controller
  const timeout = setTimeout(() => controller.abort(), 5000)
  publish({ delivery: 'sending' })
  sending = (async () => {
    try {
      const response = await fetch('/api/diagnostics', { method: 'POST', credentials: 'same-origin', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }), signal: controller.signal })
      if (!response.ok) throw new Error('Diagnostic delivery failed')
      const receipt: unknown = await response.json()
      if (!receipt || typeof receipt !== 'object' || (receipt as { accepted?: unknown }).accepted !== batch.length) throw new Error('Diagnostic receipt mismatch')
      if (token !== epoch) return false
      const sent = new Set(batch.map(item => `${item.sessionId}:${item.seq}`))
      pending = pending.filter(item => !sent.has(`${item.sessionId}:${item.seq}`))
      retryMs = 5000
      publish({ pending: pending.length, delivery: 'sent', lastSentAt: Date.now() })
      return true
    } catch {
      if (token === epoch) { retryMs = Math.min(retryMs * 2, 60_000); publish({ delivery: 'failed' }) }
      return false
    } finally { clearTimeout(timeout); request = null; sending = null; schedule() }
  })()
  return sending
}
