import { currentUserId } from '@/lib/auth'
import { recordUsage } from '@/lib/usage'
import { boundedText, readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { configuredRepoModels, runRepoAgents } from '@/lib/repo/agentOrchestrator'
import type { RepoAgentEvent, RepoAgentInput, RepoTask } from '@/lib/repo/agentTypes'
import { assertRepoModelConfigured } from '@/lib/repo/modelPolicy'
import { parseAnswerPreferences } from '@/lib/copilot/answerPreferences'

export const maxDuration = 120

export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  let input: RepoAgentInput
  try {
    const body = await readRepoJson(req, 600_000)
    const task = body.task ?? 'plan'
    if (!['plan', 'debug', 'review', 'debrief'].includes(task as string)) throw new RepoRequestError('Invalid repository task')
    input = {
      question: boundedText(body.question, 'question', 8_000, true),
      context: boundedText(body.context, 'context', 120_000, true),
      transcript: boundedText(body.transcript, 'transcript', 35_000),
      task: task as RepoTask,
      preferences: parseAnswerPreferences(body.preferences),
    }
  } catch (error) {
    return Response.json({ error: error instanceof RepoRequestError ? error.message : 'Invalid request' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  let models: ReturnType<typeof configuredRepoModels>
  try {
    models = configuredRepoModels()
    assertRepoModelConfigured(models.synthesis)
  } catch {
    return Response.json({ error: 'Repository agents need valid server model configuration and API keys' }, { status: 503 })
  }

  const cancellation = new AbortController()
  const signal = AbortSignal.any([req.signal, cancellation.signal, AbortSignal.timeout(110_000)])
  const encoder = new TextEncoder()
  let closed = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: RepoAgentEvent) => {
        if (!closed && !cancellation.signal.aborted && !req.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      }
      try {
        await runRepoAgents(input, signal, emit, models)
        recordUsage('repo-analyze', userId, { task: input.task, model: models.synthesis })
      } catch (error) {
        emit({ type: 'error', error: signal.aborted ? 'Repository analysis timed out or was cancelled' : error instanceof Error ? error.message : 'Repository analysis failed' })
      } finally {
        if (!closed) { closed = true; controller.close() }
      }
    },
    cancel() { closed = true; cancellation.abort() },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
