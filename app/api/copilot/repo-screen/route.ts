import { currentUserId } from '@/lib/auth'
import { recordUsage } from '@/lib/usage'
import { parseRepoImage, readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { repoModelFor } from '@/lib/repo/modelPolicy'
import { extractScreenEvidence, ScreenExtractionError } from '@/lib/repo/screenProvider'
import { serverDiagnostic } from '@/lib/diagnostics/server'
import { diagnosticCode } from '@/lib/diagnostics/schema'
import { retryHeaders } from '@/lib/coach/retry'

export const maxDuration = 60
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) { serverDiagnostic(req, 'screen_model', 'error', { httpStatus: 401, code: 'unauthorized' }); return Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  let image: ReturnType<typeof parseRepoImage>
  try { const body = await readRepoJson(req, 6_001_000); image = parseRepoImage(body.image) }
  catch (error) {
    serverDiagnostic(req, 'screen_model', 'error', { code: 'invalid_shape', httpStatus: error instanceof RepoRequestError ? error.status : 400 })
    return Response.json({ error: error instanceof RepoRequestError ? error.message : 'Invalid screenshot request' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  let model: string
  try { model = repoModelFor('vision').model } catch {
    serverDiagnostic(req, 'screen_model', 'error', { code: 'provider_unavailable', httpStatus: 503 })
    return Response.json({ error: 'Invalid repository vision model configuration' }, { status: 503, headers: { 'x-lt-retryable': 'false' } })
  }
  const started = Date.now()
  serverDiagnostic(req, 'screen_model', 'start', { model, retryAttempt: Number(req.headers.get('x-lt-attempt') || 1) })
  try {
    const { observation, model: actualModel, attempts = 1 } = await extractScreenEvidence({ model, image, signal: req.signal })
    recordUsage('repo-screen', userId, { model: actualModel, files: observation.files.length })
    serverDiagnostic(req, 'screen_model', 'success', { model: actualModel, attempts, durationMs: Date.now() - started, count: observation.files.length })
    return Response.json({ observation, model: actualModel }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined
    serverDiagnostic(req, 'screen_model', req.signal.aborted ? 'cancelled' : 'error', {
      model, durationMs: Date.now() - started, httpStatus: status,
      code: error instanceof ScreenExtractionError && error.validationCode ? error.validationCode : diagnosticCode(error, status),
      attempts: error instanceof ScreenExtractionError ? error.attempts : undefined,
    })
    // Semantic recovery already happens inside extraction. Never stack client retries
    // on refusals, truncation, invalid evidence or missing provider configuration.
    const headers = { 'Cache-Control': 'no-store', ...retryHeaders(error, req.signal.aborted || error instanceof ScreenExtractionError) }
    if (error instanceof ScreenExtractionError && !req.signal.aborted) return Response.json({ error: error.message }, { status: error.status, headers })
    return Response.json({ error: req.signal.aborted ? 'Screenshot capture cancelled' : 'Screenshot extraction failed or timed out. Existing evidence is unchanged.' }, { status: req.signal.aborted ? 499 : 502, headers })
  }
}
