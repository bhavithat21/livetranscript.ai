import { it, expect } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { callRepoModel, streamRepoModel, type ModelRequest } from '../../lib/repo/agentProviders'
import { assertRepoModelConfigured } from '../../lib/repo/modelPolicy'
import { coachGeneration } from '../../lib/coach/generation'
import { coachPrompt } from '../../lib/coach/prompts'
import { learningCase } from '../../lib/coach/learning/cases'
import { parseGuidance } from '../../lib/coach/validation'

// Explicit opt-in: uses real providers and incurs charges. Authored, non-private
// cases only. Results never change production routing or promote a model.
it.skipIf(process.env.COACH_BENCHMARK !== '1')('records paired latency and reviewable answers with production adapters', async () => {
  const talkModel = process.env.COPILOT_COACH_TALK_MODEL || 'claude-sonnet-5'
  const guideModel = process.env.COPILOT_COACH_GUIDE_MODEL || 'claude-sonnet-5'
  const fastModel = process.env.COACH_BENCHMARK_FAST_MODEL || 'claude-haiku-4-5-20251001'
  for (const model of new Set([talkModel, guideModel, fastModel, 'claude-sonnet-5'])) assertRepoModelConfigured(model)
  type Row = { caseId: string; repetition: number; variant: string; requestedModel: string; returnedModel: string; inputHash: string; firstTextMs: number | null; totalMs: number; answer: string; structuralPass: boolean; error: string | null; settings: object; rubric: string }
  const rows: Row[] = []
  const cases = ['deadline', 'candidate-claim', 'minimal-change', 'hold', 'stale-test', 'unseen-file']
  for (let repetition = 0; repetition < 3; repetition++) for (const caseId of cases) {
    const sample = learningCase(caseId), system = coachPrompt(sample.lane), evidence = JSON.stringify(sample.context)
    const inputHash = createHash('sha256').update(system + '\n' + evidence).digest('hex')
    const variants = sample.lane === 'talk' ? [
      { name: 'prior-generation-settings', model: 'claude-sonnet-5', settings: { maxTokens: 512 } },
      { name: 'current', model: talkModel, settings: coachGeneration(sample.lane, talkModel) },
      { name: 'fast-candidate', model: fastModel, settings: coachGeneration(sample.lane, fastModel) },
    ] : [{ name: 'current', model: guideModel, settings: coachGeneration(sample.lane, guideModel) }]
    // Alternate order to reduce systematic warm-cache/order advantage.
    for (const variant of repetition % 2 ? variants.toReversed() : variants) {
      const started = performance.now()
      let answer = '', returnedModel = '', firstTextMs: number | null = null, error: string | null = null, structuralPass = false
      const request: ModelRequest = { model: variant.model, system, evidence, signal: AbortSignal.timeout(sample.lane === 'talk' ? 8500 : 28_000), ...variant.settings }
      try {
        if (sample.lane === 'talk') {
          for await (const part of streamRepoModel(request)) {
            answer += part.text; returnedModel = part.model
            if (firstTextMs === null && answer.trim()) firstTextMs = Math.round(performance.now() - started)
          }
          structuralPass = !!answer.trim() && answer.trim().split(/\s+/).length <= 90 && !/\bI (?:have )?(?:ran|executed|applied)\b/i.test(answer)
        } else {
          const result = await callRepoModel(request); answer = result.text; returnedModel = result.model
          parseGuidance(JSON.parse(answer), sample.context); structuralPass = true
        }
      } catch (failure) { error = failure instanceof Error ? failure.name : 'RequestError' }
      rows.push({ caseId, repetition, variant: variant.name, requestedModel: variant.model, returnedModel, inputHash, firstTextMs, totalMs: Math.round(performance.now() - started), answer, structuralPass, error, settings: variant.settings, rubric: sample.rubric })
    }
  }
  await mkdir('evals/coach/results', { recursive: true })
  await writeFile(`evals/coach/results/${Date.now()}.json`, JSON.stringify({ format: 'coach-provider-comparison-v1', generatedAt: new Date().toISOString(), providerInference: true, source: 'Authored cases, not a transcription of the YouTube video', scope: 'Generation settings comparison with the same current prompt, not a full old/new deployment comparison', timing: 'Request-to-first-text/complete; no microphone, ASR, detection or rendering measurement', quality: 'Structural checks only. Correctness and naturalness require blinded human review against each rubric. No automatic winner or promotion.', rows }, null, 2))
  expect(rows.length).toBe(30)
}, 900_000)
