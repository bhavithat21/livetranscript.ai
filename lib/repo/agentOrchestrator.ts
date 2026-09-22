import { callRepoModel, streamRepoModel } from './agentProviders'
import { repoAgentEvidence, repoAgentSystem } from './agentPrompts'
import type { RepoAgentEvent, RepoAgentInput, RepoAgentRole } from './agentTypes'
import { repoModelFor } from './modelPolicy'

export type RepoAgentModels = Record<RepoAgentRole, string>
export function configuredRepoModels(): RepoAgentModels {
  return Object.fromEntries(['requirements', 'implementation', 'debugger', 'reviewer', 'synthesis'].map((role) => [role, repoModelFor(role as RepoAgentRole).model])) as RepoAgentModels
}

export async function runRepoAgents(input: RepoAgentInput, signal: AbortSignal, emit: (event: RepoAgentEvent) => void, models = configuredRepoModels()): Promise<void> {
  const evidence = repoAgentEvidence(input)
  const roles: RepoAgentRole[] = ['requirements', input.task === 'debug' ? 'debugger' : 'implementation', 'reviewer']
  const results = await Promise.all(roles.map(async (role) => {
    const started = Date.now()
    const model = models[role]
    signal.throwIfAborted()
    emit({ type: 'agent', role, model, status: 'running' })
    try {
      const result = await callRepoModel({ model, system: repoAgentSystem(role), evidence, signal })
      signal.throwIfAborted()
      emit({ type: 'agent', role, model: result.model, status: 'done', text: result.text, elapsedMs: Date.now() - started })
      return { role, model: result.model, status: 'done' as const, text: result.text }
    } catch {
      signal.throwIfAborted()
      const text = `${role} analysis unavailable (provider error, timeout, or model configuration). No opinion was obtained from this specialist.`
      emit({ type: 'agent', role, model, status: 'failed', text, elapsedMs: Date.now() - started })
      return { role, model, status: 'failed' as const, text }
    }
  }))
  signal.throwIfAborted()
  if (results.every((result) => result.status === 'failed')) throw new Error('All repository specialists failed. Check the configured model API keys and retry.')

  const started = Date.now()
  let model = models.synthesis
  emit({ type: 'agent', role: 'synthesis', model, status: 'running' })
  let text = ''
  try {
    for await (const delta of streamRepoModel({ model, system: repoAgentSystem('synthesis'), evidence: JSON.stringify({ sourceEvidence: JSON.parse(evidence), specialistReports: results }), signal })) {
      signal.throwIfAborted()
      model = delta.model
      text += delta.text
      emit({ type: 'delta', text: delta.text })
    }
    if (!text.trim()) throw new Error('No synthesis returned')
    emit({ type: 'agent', role: 'synthesis', model, status: 'done', elapsedMs: Date.now() - started })
    emit({ type: 'done' })
  } catch {
    signal.throwIfAborted()
    emit({ type: 'agent', role: 'synthesis', model, status: 'failed', text: 'Synthesis failed. Specialist notes remain available; any partial answer is incomplete.', elapsedMs: Date.now() - started })
    throw new Error('Repository answer incomplete. Check specialist notes and retry.')
  }
}
