import { configuredDraftModel, modelForTier } from '../copilot/modes'
import { probeAnswerModel } from '../copilot/providers'
import { streamRepoModel } from '../repo/agentProviders'
import { repoModelFor } from '../repo/modelPolicy'
import { extractScreenEvidence } from '../repo/screenProvider'
import { mintTranscriptionToken } from '../transcription/token'
import type { ScreenObservation } from '../repo/screenEvidence'
import { diagnosticCode } from '../diagnostics/schema'
import { SPEECH_PROVIDERS, speechConfiguration } from './speechPolicy'

export type ProbeCheck = { role: string; model?: string; status: 'passed' | 'failed' | 'disabled'; durationMs: number; code?: string }
export type PreflightReport = { version: 1; at: number; passed: boolean; scope: 'synthetic-server-probes'; deviceVerified: false; checks: ProbeCheck[] }
const BLANK = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKUlEQVR4nO3NMQEAAAjDMMC/52ECvlRA00nqs3m9AwAAAAAAAAAAgMMWx/EDPS4YA2MAAAAASUVORK5CYII='
export async function runPreflight(parent: AbortSignal, image = BLANK, validateVision?: (observation: ScreenObservation) => void): Promise<PreflightReport> {
  const checks: ProbeCheck[] = []
  const tasks: Array<{ role: string; model?: string; run: (signal: AbortSignal) => Promise<unknown> }> = []
  for (const lane of ['talk', 'guide', 'review'] as const) {
    const role = lane === 'talk' ? 'requirements' : lane === 'review' ? 'reviewer' : 'implementation'
    try {
      const model = process.env[`COPILOT_COACH_${lane.toUpperCase()}_MODEL`] || repoModelFor(role).model
      tasks.push({ role: lane, model, run: async signal => { let text = ''; for await (const chunk of streamRepoModel({ model, system: 'Reply READY only.', evidence: 'Synthetic readiness check.', signal, maxTokens: lane === 'talk' ? 384 : 512 })) text += chunk.text; if (!text.trim()) throw new Error('No answer') } })
    } catch { checks.push({ role: lane, status: 'failed', durationMs: 0, code: 'provider_unavailable' }) }
  }
  try {
    const model = repoModelFor('vision').model
    tasks.push({ role: 'screen', model, run: async signal => { const result = await extractScreenEvidence({ model, image: { mediaType: 'image/png', data: image }, signal }); validateVision?.(result.observation) } })
  } catch { checks.push({ role: 'screen', status: 'failed', durationMs: 0, code: 'provider_unavailable' }) }
  for (const [role, model] of [['draft', configuredDraftModel()], ['answer', modelForTier('smart')]] as const) {
    if (!model) { checks.push({ role, status: 'disabled', durationMs: 0 }); continue }
    tasks.push({ role, model, run: signal => probeAnswerModel(model, signal) })
  }
  const speech = speechConfiguration()
  if (!speech.hasProvider) checks.push({ role: 'transcription', status: 'failed', durationMs: 0, code: 'provider_unavailable' })
  for (const provider of SPEECH_PROVIDERS) {
    if (!speech.enabled.includes(provider)) { checks.push({ role: `${provider}-token`, status: 'disabled', durationMs: 0, code: 'unavailable' }); continue }
    tasks.push({ role: `${provider}-token`, run: signal => mintTranscriptionToken(provider, signal) })
  }
  let next = 0
  async function worker() {
    for (;;) {
      const task = tasks[next++]; if (!task) return
      const started = Date.now()
      try {
        const signal = AbortSignal.any([parent, AbortSignal.timeout(12_000)])
        signal.throwIfAborted(); await task.run(signal); signal.throwIfAborted()
        checks.push({ role: task.role, model: task.model, status: 'passed', durationMs: Date.now() - started })
      } catch (error) {
        const status = (error as { status?: number })?.status
        checks.push({ role: task.role, model: task.model, status: 'failed', durationMs: Date.now() - started, code: diagnosticCode(error, status) })
      }
    }
  }
  await Promise.all([worker(), worker()])
  return { version: 1, at: Date.now(), passed: checks.length > 0 && checks.every(check => check.status !== 'failed'), scope: 'synthetic-server-probes', deviceVerified: false, checks }
}
