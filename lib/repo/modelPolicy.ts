import type { RepoAgentRole } from './agentTypes'

// Defaults are operational choices, NOT measured benchmark winners. Current ID
// verified against https://platform.claude.com/docs/en/models/overview (2026-09-22).
export const DEFAULT_REPO_MODEL = 'claude-sonnet-5'
export const REPO_AGENT_ROLES: RepoAgentRole[] = ['requirements', 'implementation', 'debugger', 'reviewer', 'synthesis']
export type RepoModelSelection = { model: string; source: 'configured' | 'measured' | 'default'; benchmarkId?: string }

const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/
export function validRepoModel(model: unknown): model is string { return typeof model === 'string' && MODEL_ID.test(model) }

export function repoModelFor(role: RepoAgentRole | 'vision', env: Record<string, string | undefined> = process.env): RepoModelSelection {
  const configured = env[`COPILOT_REPO_MODEL_${role.toUpperCase()}`]
  if (configured) {
    if (!validRepoModel(configured)) throw new Error(`Invalid model configuration for ${role}`)
    return { model: configured, source: 'configured' }
  }
  // A report must be explicitly reviewed before it can drive routing; benchmark
  // proxy scores alone cannot establish correctness or interview success.
  const report = env.COPILOT_REPO_BENCHMARK_POLICY
  if (report && role !== 'vision') {
    let value: unknown
    try { value = JSON.parse(report) } catch { throw new Error('Invalid repository benchmark policy JSON') }
    const policy = value as { version?: number; reviewed?: boolean; roles?: Partial<Record<RepoAgentRole, { model?: string; samples?: number; benchmarkId?: string }>> } | null
    if (policy?.version !== 1 || policy.reviewed !== true) throw new Error('Repository benchmark policy requires reviewed version 1 results')
    const result = policy.roles?.[role]
    if (result) {
      if (!validRepoModel(result.model) || !Number.isInteger(result.samples) || (result.samples ?? 0) < 3 || typeof result.benchmarkId !== 'string' || !result.benchmarkId.trim()) {
        throw new Error(`Incomplete measured policy for ${role}`)
      }
      return { model: result.model, source: 'measured', benchmarkId: result.benchmarkId }
    }
  }
  return { model: DEFAULT_REPO_MODEL, source: 'default' }
}

export function repoProvider(model: string): 'anthropic' | 'openai' | 'groq' {
  if (model.startsWith('claude-')) return 'anthropic'
  if (/^(?:llama|qwen|moonshotai|meta-llama|openai\/)/.test(model)) return 'groq'
  return 'openai'
}

export function assertRepoModelConfigured(model: string): void {
  const key = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', groq: 'GROQ_API_KEY' }[repoProvider(model)]
  if (!process.env[key]) throw new Error(`${key} is required for ${model}`)
}
