import type { ModelRequest } from '../repo/agentProviders'
import type { Lane } from './types'

const string = { type: 'string' }, integer = { type: 'integer' }, line = { type: ['integer', 'null'] }
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const array = (items: unknown) => ({ type: 'array', items })
const evidence = array(object({ sourceId: string, path: string, fileVersion: integer, startLine: line, endLine: line }))
// Keep one stable schema for grammar caching. Semantic grounding, array limits,
// exact preimages and implementation permission are still validated locally.
export const GUIDANCE_SCHEMA = object({
  summary: string,
  look: array(object({ path: string, startLine: line, endLine: line, symbol: string, reason: string })),
  patches: array(object({ path: string, fileVersion: integer, startLine: integer, before: string, after: string, reason: string })),
  findings: array(object({ severity: { type: 'string', enum: ['blocking', 'review', 'optional'] }, category: { type: 'string', enum: ['correctness', 'scope', 'security', 'tests', 'readability'] }, text: string, evidence })),
  verify: array(object({ command: string, scope: string, reason: string })),
  hypotheses: array(object({ explanation: string, evidence })),
})

/** Model identity still comes from the reviewed policy or explicit server override.
 * These settings are shared with the coach benchmark; no unmeasured auto-routing. */
export function coachGeneration(lane: Lane, model: string): Pick<ModelRequest, 'maxTokens' | 'thinking' | 'effort' | 'cacheSystem' | 'schema'> {
  const sonnet5 = /^claude-sonnet-5(?:-|$)/.test(model)
  const structured = /^claude-(?:sonnet-(?:5|4-6|4-5)|haiku-4-5|opus-(?:5|4-8|4-7|4-6))/.test(model)
  return {
    maxTokens: lane === 'talk' ? 640 : sonnet5 ? 6000 : 3400,
    ...(model.startsWith('claude-') ? { cacheSystem: true } : {}),
    ...(sonnet5 ? { thinking: lane === 'talk' ? 'disabled' : 'adaptive', effort: lane === 'talk' ? 'low' : 'medium' } : {}),
    ...(lane !== 'talk' && structured ? { schema: GUIDANCE_SCHEMA } : {}),
  }
}
