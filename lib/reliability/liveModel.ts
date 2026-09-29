import { repoModelFor, repoProvider } from '../repo/modelPolicy'
import type { Lane } from '../coach/types'

/** Resolve the same model for preflight and live requests. Explicit administrator
 * settings and measured policies are never rewritten. Only unconfigured defaults
 * can choose another keyed provider; actual access is verified by preflight. */
export function liveCoachModel(lane: Lane, env: Record<string, string | undefined> = process.env): string {
  const override = env[`COPILOT_COACH_${lane.toUpperCase()}_MODEL`]
  if (override) return override
  const role = lane === 'talk' ? 'requirements' : lane === 'review' ? 'reviewer' : 'implementation'
  const selection = repoModelFor(role, env)
  if (selection.source !== 'default') return selection.model
  const keyed = (model: string) => Boolean(env[{ openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', groq: 'GROQ_API_KEY', gemini: 'GEMINI_API_KEY' }[repoProvider(model)]])
  if (keyed(selection.model)) return selection.model
  const candidates = lane === 'talk'
    ? ['openai/gpt-oss-120b', 'claude-sonnet-5-5']
    : ['claude-sonnet-5-5', 'openai/gpt-oss-120b']
  return candidates.find(keyed) ?? selection.model
}
