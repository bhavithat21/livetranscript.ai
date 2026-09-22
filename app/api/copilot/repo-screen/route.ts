import Anthropic from '@anthropic-ai/sdk'
import { currentUserId } from '@/lib/auth'
import { recordUsage } from '@/lib/usage'
import { parseRepoImage, readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { SCREEN_EXTRACTION_PROMPT } from '@/lib/repo/agentPrompts'
import { repoModelFor } from '@/lib/repo/modelPolicy'
import { parseScreenObservation } from '@/lib/repo/screenEvidence'

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
  if (!model.startsWith('claude-') || !process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'Screenshot reconstruction requires ANTHROPIC_API_KEY and a Claude vision model' }, { status: 503 })
  }
  try {
    const signal = AbortSignal.any([req.signal, AbortSignal.timeout(35_000)])
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 35_000 })
    const result = await client.messages.create({
      model,
      max_tokens: 6000,
      system: SCREEN_EXTRACTION_PROMPT,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
        { type: 'text', text: 'Transcribe the visible code, paths, requirements and terminal evidence.' },
      ] }],
    }, { signal })
    if (result.stop_reason === 'max_tokens') return Response.json({ error: 'Screenshot contains too much text. Capture a smaller visible region.' }, { status: 422 })
    const raw = result.content.flatMap((part) => part.type === 'text' ? [part.text] : []).join('\n').trim()
    // Accept harmless JSON fences, never regex-extract a convenient object from prose.
    const json = raw.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    const observation = parseScreenObservation(JSON.parse(json))
    if (!observation) return Response.json({ error: 'Screenshot extraction returned invalid evidence. Try a clearer capture.' }, { status: 502 })
    recordUsage('repo-screen', userId, { model: result.model, files: observation.files.length })
    return Response.json({ observation, model: result.model }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return Response.json({ error: req.signal.aborted ? 'Screenshot capture cancelled' : 'Screenshot extraction failed or timed out. Existing evidence is unchanged.' }, { status: req.signal.aborted ? 499 : 502 })
  }
}
