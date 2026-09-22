import type { CopilotMode } from './modes'

export type Classification = { isQuestion: boolean; mode: CopilotMode; needsWeb: boolean; confidence: number }
export const CLASSIFIER_MODES: CopilotMode[] = ['general', 'repoInterview', 'coding', 'systemDesign', 'behavioral']

export function probability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

export function parseClassification(value: unknown): Classification | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (!CLASSIFIER_MODES.includes(item.mode as CopilotMode) || !probability(item.confidence)
    || typeof item.isQuestion !== 'boolean' || typeof item.needsWeb !== 'boolean') return null
  return item as Classification
}
