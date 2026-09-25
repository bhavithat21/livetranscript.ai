import type { CodePlan, Lane } from './types'
import { parsePlan } from './engine'

export async function requestGuidance(lane: Lane, context: string, question: string, signal: AbortSignal, onDelta?: (text: string) => void): Promise<{ text: string; plan: CodePlan | null; model: string; firstTokenMs: number | null }> {
  const started = performance.now()
  const response = await fetch('/api/copilot/repo-live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lane, context, question }), signal })
  if (!response.ok || !response.body) { const body = await response.json().catch(() => ({})); throw new Error(typeof body.error === 'string' ? body.error : `Analysis unavailable (${response.status})`) }
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffered = '', text = '', model = '', doneEvent = false, size = 0, plan: CodePlan | null = null, firstTokenMs: number | null = null
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel)
  function consume(line: string) {
    if (!line.trim()) return
    const e = JSON.parse(line)
    if (!e || typeof e !== 'object') throw new Error('Invalid stream event')
    if (e.type === 'error') throw new Error(typeof e.error === 'string' ? e.error : 'Analysis failed')
    if (typeof e.model === 'string' && e.model.length <= 160) model = e.model
    if (e.type === 'delta') {
      if (lane !== 'say' || typeof e.text !== 'string' || text.length + e.text.length > 12000) throw new Error('Invalid response text')
      if (firstTokenMs === null) firstTokenMs = Math.round(performance.now() - started)
      text += e.text; onDelta?.(text)
    }
    if (e.type === 'plan') plan = parsePlan(e.plan)
    if (e.type === 'done') doneEvent = true
  }
  try {
    for (;;) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      size += value?.byteLength ?? 0
      if (size > 160000) throw new Error('Response exceeded its budget')
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const lines = buffered.split('\n'); buffered = lines.pop() ?? ''
      for (const line of lines) consume(line)
      if (done) { consume(buffered); break }
    }
    signal.throwIfAborted()
    if (!doneEvent || !model || (lane === 'say' ? !text.trim() : !plan)) throw new Error('Incomplete analysis; no final result accepted')
    return { text, plan, model, firstTokenMs }
  } finally { signal.removeEventListener('abort', cancel); void reader.cancel().catch(() => {}); reader.releaseLock() }
}
