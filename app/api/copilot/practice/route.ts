import { currentUserId } from '@/lib/auth'
import { recordUsage } from '@/lib/usage'
import { fallbackChain, hasKeyFor, modelForTier, vendorForModel } from '@/lib/copilot/modes'
import { callRepoModel } from '@/lib/repo/agentProviders'
import { readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { repoProvider, validRepoModel } from '@/lib/repo/modelPolicy'
import { parsePracticeRequest, parsePracticeResponse } from '@/lib/practice/protocol'
import { PRACTICE_SYSTEM } from '@/lib/practice/prompts'

export const maxDuration = 40

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Sign in to start a practice interview.' }, { status: 401 })
  let input
  try { input = parsePracticeRequest(await readRepoJson(req, 300_000)) }
  catch (error) {
    return Response.json({ error: error instanceof RepoRequestError ? error.message : 'Invalid practice request' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  const configured = process.env.COPILOT_PRACTICE_MODEL
  const primary = configured || modelForTier('smart')
  const model = configured ? primary : [primary, ...fallbackChain(primary)].find(hasKeyFor)
  if (!model || !validRepoModel(model) || vendorForModel(model) === 'google' || repoProvider(model) !== vendorForModel(model) || !hasKeyFor(model)) {
    return Response.json({ error: 'Practice coaching is unavailable. The server needs a supported model and provider API key.' }, { status: 503 })
  }
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(32_000)])
  try {
    const result = await callRepoModel({ model, system: PRACTICE_SYSTEM, evidence: JSON.stringify(input), signal, maxTokens: 3_200 })
    signal.throwIfAborted()
    const response = parsePracticeResponse(result.text, input, result.model)
    recordUsage('practice', userId, { action: input.action, kind: input.kind, model: result.model })
    return Response.json(response, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    // Provider exceptions may contain prompt excerpts. Keep private answers out
    // of logs and make incomplete or unsupported evidence explicitly retryable.
    return Response.json({ error: signal.aborted ? 'Practice request timed out or was cancelled. Your answer is still in this tab.' : 'The coach could not return a complete, evidence-supported response. Your answer is kept; try again.' }, { status: signal.aborted ? 504 : 502 })
  }
}
