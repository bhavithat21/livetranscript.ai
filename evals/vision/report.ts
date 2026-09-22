import { createHash } from 'node:crypto'
import { SCREEN_EXTRACTION_PROMPT } from '../../lib/repo/agentPrompts'
import type { ScreenObservation } from '../../lib/repo/screenEvidence'
import { visionFixtures, VISION_FIXTURE_VERSION } from './fixtures'
import { fixtureSvg } from './render'
import type { VisionScore } from './score'

export const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex')
export const visionSuiteSha256 = (): string => sha256(JSON.stringify({ version: VISION_FIXTURE_VERSION, prompt: SCREEN_EXTRACTION_PROMPT, fixtures: visionFixtures.map((fixture) => ({ ...fixture, svg: fixtureSvg(fixture) })) }))

export interface VisionRow {
  requestedModel: string
  actualModel?: string
  fixture: string
  repetition: number
  latencyMs: number
  imageSha256: string
  usage?: { inputTokens: number; outputTokens: number }
  observation?: ScreenObservation
  raw?: string
  score?: VisionScore
  error?: string
}
export interface VisionReport {
  version: 1
  purpose: 'vision'
  benchmarkId: string
  measuredAt: string
  suiteSha256: string
  complete: boolean
  limits: string
  candidates: string[]
  repetitions: number
  plannedCalls: number
  images: Array<{ fixture: string; sha256: string; path: string }>
  rows: VisionRow[]
}

export function visionRunConfiguration(env: Record<string, string | undefined> = process.env): { candidates: string[]; repetitions: number; plannedCalls: number } {
  const candidates = [...new Set((env.VISION_BENCHMARK_MODELS ?? '').split(',').map((value) => value.trim()).filter(Boolean))]
  if (!candidates.length || candidates.length > 6 || candidates.some((model) => !/^claude-[a-zA-Z0-9._:/-]{1,112}$/.test(model))) throw new Error('Set VISION_BENCHMARK_MODELS to 1-6 account-supported Claude model IDs')
  const repetitions = Number(env.VISION_BENCHMARK_REPEATS ?? '3')
  const maxCalls = Number(env.VISION_BENCHMARK_MAX_CALLS ?? '96')
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('VISION_BENCHMARK_REPEATS must be 1-10')
  if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 96) throw new Error('VISION_BENCHMARK_MAX_CALLS must be 1-96')
  const plannedCalls = candidates.length * repetitions * visionFixtures.length
  if (plannedCalls > maxCalls) throw new Error(`Planned ${plannedCalls} paid calls exceeds the configured call cap ${maxCalls}`)
  return { candidates, repetitions, plannedCalls }
}
