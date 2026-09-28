import { currentUserId } from '@/lib/auth'
import { recordUsage } from '@/lib/usage'
import { parseRepoImage, readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { repoModelFor } from '@/lib/repo/modelPolicy'
import { extractScreenEvidence, ScreenExtractionError } from '@/lib/repo/screenProvider'
import { SCREEN_ERRORS, type ScreenErrorCode } from '@/lib/coach/screenErrors'

export const maxDuration = 60

export async function POST(req: Request) {
  const startedAt = Date.now(), requestId = crypto.randomUUID()
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: SCREEN_ERRORS.unauthorized, code: 'unauthorized' }, { status: 401 })
  let image: ReturnType<typeof parseRepoImage>
  try {
    const body = await readRepoJson(req, 6_001_000)
    image = parseRepoImage(body.image)
  } catch (error) {
    return Response.json({ error: error instanceof RepoRequestError ? error.message : 'Invalid screenshot request' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  let model: string
  try { model = repoModelFor('vision').model } catch {
    console.warn(JSON.stringify({ event: 'coach.screen.failed', requestId, code: 'configuration', totalMs: Date.now() - startedAt }))
    return Response.json({ error: SCREEN_ERRORS.configuration, code: 'configuration' }, { status: 503 })
  }
  try {
    const { observation, model: actualModel } = await extractScreenEvidence({ model, image, signal: req.signal })
    recordUsage('repo-screen', userId, { model: actualModel, files: observation.files.length })
    console.info(JSON.stringify({ event: 'coach.screen.complete', requestId, model: actualModel, totalMs: Date.now() - startedAt, files: observation.files.length }))
    return Response.json({ observation, model: actualModel }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 502
    const code: ScreenErrorCode = req.signal.aborted ? 'cancelled' : error instanceof ScreenExtractionError ? error.code
      : error instanceof Error && /timeout|abort/i.test(error.name) ? 'timeout' : status === 429 ? 'rate' : status === 401 || status === 403 ? 'configuration' : 'provider'
    // No image, transcript, user identity, API key, or raw provider error in logs.
    console.warn(JSON.stringify({ event: 'coach.screen.failed', requestId, model, code, totalMs: Date.now() - startedAt }))
    return Response.json({ error: SCREEN_ERRORS[code], code }, { status: req.signal.aborted ? 499 : error instanceof ScreenExtractionError ? error.status : code === 'rate' ? 429 : 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
