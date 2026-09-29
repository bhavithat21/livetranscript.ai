import { currentUserId } from '@/lib/auth'
import { recordUsage } from '@/lib/usage'
import { parseRepoImage, readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { repoModelFor } from '@/lib/repo/modelPolicy'
import { extractScreenEvidence, ScreenExtractionError } from '@/lib/repo/screenProvider'

export const maxDuration = 60

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let image: ReturnType<typeof parseRepoImage>
  try {
    const body = await readRepoJson(req, 6_001_000)
    image = parseRepoImage(body.image)
  } catch (error) {
    return Response.json({ error: error instanceof RepoRequestError ? error.message : 'Invalid screenshot request' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  let model: string
  try { model = repoModelFor('vision').model } catch {
    return Response.json({ error: 'Invalid repository vision model configuration' }, { status: 503 })
  }
  const started = Date.now()
  try {
    const { observation, model: actualModel, attempts = 1 } = await extractScreenEvidence({ model, image, signal: req.signal })
    recordUsage('repo-screen', userId, { model: actualModel, files: observation.files.length })
    if (attempts > 1) console.info('[repo-screen/recovered]', { model: actualModel, attempts, elapsedMs: Date.now() - started })
    // Diagnostics stay server-side; preserve the client response contract.
    return Response.json({ observation, model: actualModel }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // Metadata only: never log screenshot data, model responses or SDK messages.
    const providerStatus = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined
    console.warn('[repo-screen]', { model, elapsedMs: Date.now() - started, kind: error instanceof ScreenExtractionError ? error.message : error instanceof Error ? error.name : 'unknown', status: providerStatus, cancelled: req.signal.aborted, validationCode: error instanceof ScreenExtractionError ? error.validationCode : undefined, attempts: error instanceof ScreenExtractionError ? error.attempts : undefined })
    if (error instanceof ScreenExtractionError && !req.signal.aborted) {
      return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
    }
    return Response.json({ error: req.signal.aborted ? 'Screenshot capture cancelled' : 'Screenshot extraction failed or timed out. Existing evidence is unchanged.' }, { status: req.signal.aborted ? 499 : 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
