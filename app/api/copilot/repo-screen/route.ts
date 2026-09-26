import { currentUserId } from '@/lib/auth'
import { recordUsage } from '@/lib/usage'
import { parseRepoImage, readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { repoModelFor } from '@/lib/repo/modelPolicy'
import { extractScreenEvidence, ScreenExtractionError } from '@/lib/repo/screenProvider'

export const maxDuration = 60

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let locateRows = false
  let image: ReturnType<typeof parseRepoImage>
  try {
    const body = await readRepoJson(req, 6_001_000)
    image = parseRepoImage(body.image)
    locateRows = body.locateRows === true
  } catch (error) {
    return Response.json({ error: error instanceof RepoRequestError ? error.message : 'Invalid screenshot request' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  let model: string
  try { model = repoModelFor('vision').model } catch {
    return Response.json({ error: 'Invalid repository vision model configuration' }, { status: 503 })
  }
  try {
    const { observation, model: actualModel } = await extractScreenEvidence({ model, image, signal: req.signal, locateRows })
    recordUsage('repo-screen', userId, { model: actualModel, files: observation.files.length })
    return Response.json({ observation, model: actualModel }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof ScreenExtractionError && !req.signal.aborted) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: req.signal.aborted ? 'Screenshot capture cancelled' : 'Screenshot extraction failed or timed out. Existing evidence is unchanged.' }, { status: req.signal.aborted ? 499 : 502 })
  }
}
