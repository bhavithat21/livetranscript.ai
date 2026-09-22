import type { RepoAgentRole } from './agentTypes'

// Defaults are operational choices, NOT measured benchmark winners. Current ID
// verified against https://platform.claude.com/docs/en/models/overview (2026-09-22).
export const DEFAULT_REPO_MODEL = 'claude-sonnet-5'
export const REPO_AGENT_ROLES: RepoAgentRole[] = ['requirements', 'implementation', 'debugger', 'reviewer', 'synthesis']
export type RepoModelSelection = { model: string; source: 'configured' | 'measured' | 'default'; benchmarkId?: string }
export type RepoModelPurpose = RepoAgentRole | 'navigation' | 'vision'
export type RepoQualityGates = { minDistinctCases: number; minRepetitions: number; minPassRate: number; maxErrorRate: number; maxP95LatencyMs: number }
export type RepoPurposeMeasurement = { purpose: RepoModelPurpose; samples: number; distinctCases: number; repetitions: number; passRate: number; errorRate: number; p95LatencyMs: number }
export type MeasuredRepoRole = {
  model: string; samples: number; benchmarkId: string; qualityGates: RepoQualityGates; measurements: RepoPurposeMeasurement[]
  evidence: { reportSha256: string; reviewSha256: string; suiteSha256: string }
}
export type RepoBenchmarkPolicy = {
  version: 2; reviewed: true; reviewer: string; reviewedAt: string
  roles: Partial<Record<RepoAgentRole | 'vision', MeasuredRepoRole>>
}

const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/
export function validRepoModel(model: unknown): model is string { return typeof model === 'string' && MODEL_ID.test(model) }

const SHA256 = /^[a-f0-9]{64}$/
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
export function validRepoQualityGates(value: unknown): value is RepoQualityGates {
  const gates = value as RepoQualityGates | null
  return !!gates && Number.isInteger(gates.minDistinctCases) && gates.minDistinctCases >= 3 && Number.isInteger(gates.minRepetitions) && gates.minRepetitions >= 2
    && finite(gates.minPassRate) && gates.minPassRate >= 0.9 && gates.minPassRate <= 1
    && finite(gates.maxErrorRate) && gates.maxErrorRate >= 0 && gates.maxErrorRate <= 0.1
    && finite(gates.maxP95LatencyMs) && gates.maxP95LatencyMs > 0
}

function validMeasuredRole(role: RepoAgentRole | 'vision', result: MeasuredRepoRole): boolean {
  if (!result || !validRepoModel(result.model) || (role === 'vision' && !result.model.startsWith('claude-')) || typeof result.benchmarkId !== 'string' || !result.benchmarkId.trim()
    || !validRepoQualityGates(result.qualityGates) || !Number.isInteger(result.samples) || !Array.isArray(result.measurements)
    || !result.evidence || ![result.evidence.reportSha256, result.evidence.reviewSha256, result.evidence.suiteSha256].every((hash) => typeof hash === 'string' && SHA256.test(hash))) return false
  const expected = role === 'requirements' ? ['requirements', 'navigation'] : [role]
  if (result.measurements.length !== expected.length || new Set(result.measurements.map((item) => item.purpose)).size !== expected.length) return false
  const gates = result.qualityGates
  return result.samples === result.measurements.reduce((sum, item) => sum + item.samples, 0) && result.measurements.every((item) => expected.includes(item.purpose)
    && Number.isInteger(item.distinctCases) && item.distinctCases >= gates.minDistinctCases
    && Number.isInteger(item.repetitions) && item.repetitions >= gates.minRepetitions
    && Number.isInteger(item.samples) && item.samples === item.distinctCases * item.repetitions
    && finite(item.passRate) && item.passRate >= gates.minPassRate && item.passRate <= 1
    && finite(item.errorRate) && item.errorRate >= 0 && item.errorRate <= gates.maxErrorRate
    && item.passRate + item.errorRate <= 1 + Number.EPSILON
    && finite(item.p95LatencyMs) && item.p95LatencyMs >= 0 && item.p95LatencyMs <= gates.maxP95LatencyMs)
}

export function repoModelFor(role: RepoAgentRole | 'vision', env: Record<string, string | undefined> = process.env): RepoModelSelection {
  const configured = env[`COPILOT_REPO_MODEL_${role.toUpperCase()}`]
  if (configured) {
    if (!validRepoModel(configured)) throw new Error(`Invalid model configuration for ${role}`)
    return { model: configured, source: 'configured' }
  }
  // A v2 measured policy comes from the offline review compiler. This validates
  // its evidence contract, not a cryptographic attestation by the administrator.
  const report = env.COPILOT_REPO_BENCHMARK_POLICY
  if (report) {
    let value: unknown
    try { value = JSON.parse(report) } catch { throw new Error('Invalid repository benchmark policy JSON') }
    const policy = value as (Omit<RepoBenchmarkPolicy, 'version'> & { version: number }) | null
    if (!policy || policy.reviewed !== true || (policy.version !== 1 && policy.version !== 2)) throw new Error('Repository benchmark policy requires reviewed version 1 or 2 results')
    const result = policy.roles?.[role]
    if (result) {
      if (policy.version === 1) {
        // Backward-compatible routing, but three arbitrary samples do not prove
        // distinct scenarios or correctness. Do not label legacy config measured.
        if (role === 'vision') return { model: DEFAULT_REPO_MODEL, source: 'default' }
        if (!validRepoModel(result.model) || !Number.isInteger(result.samples) || result.samples < 3 || typeof result.benchmarkId !== 'string' || !result.benchmarkId.trim()) throw new Error(`Incomplete configured policy for ${role}`)
        return { model: result.model, source: 'configured' }
      }
      if (typeof policy.reviewer !== 'string' || !policy.reviewer.trim() || typeof policy.reviewedAt !== 'string' || !Number.isFinite(Date.parse(policy.reviewedAt)) || !validMeasuredRole(role, result)) throw new Error(`Incomplete measured policy for ${role}`)
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
