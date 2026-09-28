import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { recordUsage } from '@/lib/usage'
import { readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { callRepoModel, streamRepoModel, RepoModelResponseError, type ModelUsage } from '@/lib/repo/agentProviders'
import { coachGeneration } from '@/lib/coach/generation'
import { COACH_ERRORS, type CoachErrorCode } from '@/lib/coach/errors'
import { assertRepoModelConfigured, repoModelFor, validRepoModel } from '@/lib/repo/modelPolicy'
import { parseContext } from '@/lib/coach/context'
import { object, parseGuidance } from '@/lib/coach/validation'
import { lessonIds, lessonPrompt, type LessonId } from '@/lib/coach/learning/policy'
import { coachPrompt } from '@/lib/coach/prompts'
import type { ContextPacket, Lane } from '@/lib/coach/types'

export const maxDuration = 40
export async function POST(req: Request) {
  const userId = await currentUserId()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  if (req.headers.get('origin') !== new URL(req.url).origin) return Response.json({ error: 'Same-origin request required' }, { status: 403 })
  // Per-instance protection, not a fleet-wide spending guarantee.
  if (!rateLimit(`repo-coach:${userId}`, 18, 60_000)) return Response.json({ error: 'Model request budget reached. Pause before retrying.' }, { status: 429, headers: { 'Retry-After': '10' } })
  let lane: Lane, context: ContextPacket, lessons: LessonId[]
  try {
    const body = object(await readRepoJson(req, 100_000), ['lane', 'context', 'lessons'])
    if (!['talk', 'guide', 'review'].includes(String(body.lane))) throw new Error('Invalid lane')
    lane = body.lane as Lane; context = parseContext(body.context); lessons = lessonIds(body.lessons ?? [])
  } catch (error) {
    return Response.json({ error: 'Invalid or oversized repository context' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  let model: string
  try {
    const role = lane === 'talk' ? 'requirements' : lane === 'review' ? 'reviewer' : 'implementation'
    model = process.env[`COPILOT_COACH_${lane.toUpperCase()}_MODEL`] || repoModelFor(role).model
    if (!validRepoModel(model)) throw new Error('Invalid model')
    assertRepoModelConfigured(model)
  } catch {
    return Response.json({ error: 'Configure an available model and provider key for this assistance role.' }, { status: 503 })
  }
  const cancellation = new AbortController()
  const signal = AbortSignal.any([req.signal, cancellation.signal, AbortSignal.timeout(lane === 'talk' ? 8500 : 28_000)])
  const encoder = new TextEncoder(), started = performance.now()
  let closed = false, usage: ModelUsage | undefined
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (value: Record<string, unknown>) => { if (!closed && !signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)) }
      let stage: 'provider' | 'format' | 'evidence' = 'provider'
      try {
        emit({ type: 'started', lane, evidenceVersion: context.evidenceVersion })
        const request = { model, system: coachPrompt(lane) + lessonPrompt(lessons), evidence: JSON.stringify(context), signal, ...coachGeneration(lane, model) }
        if (lane === 'talk') {
          let returned = model, visible = '', firstTextMs: number | null = null
          for await (const part of streamRepoModel({ ...request, onUsage: value => { usage = value } })) {
            returned = part.model; visible += part.text
            if (visible.length > 12_000) throw new Error('Talk output budget exceeded')
            if (firstTextMs === null && visible.trim()) firstTextMs = Math.round(performance.now() - started)
            emit({ type: 'delta', text: part.text, model: returned })
          }
          if (!visible.trim()) throw new Error('No spoken guidance returned')
          emit({ type: 'done', model: returned, guidance: null, firstTextMs, elapsedMs: Math.round(performance.now() - started) })
        } else {
          const result = await callRepoModel(request)
          usage = result.usage
          stage = 'format'
          const raw: unknown = JSON.parse(result.text.trim())
          stage = 'evidence'
          const guidance = parseGuidance(raw, context)
          emit({ type: 'done', model: result.model, guidance, elapsedMs: Math.round(performance.now() - started) })
        }
        recordUsage('repo-coach', userId, { lane, model, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, elapsedMs: Math.round(performance.now() - started) })
      } catch (error) {
        const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
        const code: CoachErrorCode = signal.aborted ? 'timeout' : error instanceof RepoModelResponseError && /output limit/.test(error.message) ? 'budget' : status === 429 ? 'rate' : [400, 401, 403, 404].includes(status) ? 'configuration' : stage
        // Safe operational evidence: never log prompts, transcripts, images,
        // source text, keys, user identifiers or raw provider error messages.
        console.warn('coach_request_failed', { lane, model, code, elapsedMs: Math.round(performance.now() - started) })
        if (!closed && !req.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', code, error: COACH_ERRORS[code] })}\n`))
      } finally { if (!closed) { closed = true; controller.close() } }
    },
    cancel() { closed = true; cancellation.abort() },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
