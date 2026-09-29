import { currentUserId } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { recordUsage } from '@/lib/usage'
import { readRepoJson, RepoRequestError } from '@/lib/repo/agentHttp'
import { callRepoModel, streamRepoModel, type ModelUsage } from '@/lib/repo/agentProviders'
import { assertRepoModelConfigured, validRepoModel } from '@/lib/repo/modelPolicy'
import { liveCoachModel } from '@/lib/reliability/liveModel'
import { parseContext } from '@/lib/coach/context'
import { object, parseGuidance, text } from '@/lib/coach/validation'
import { lessonIds, lessonPrompt, type LessonId } from '@/lib/coach/learning/policy'
import { coachPrompt } from '@/lib/coach/prompts'
import { compileInterviewPrompt } from '@/lib/coach/interviewContext'
import type { ContextPacket, Lane } from '@/lib/coach/types'
import { judgeLiveContext, routeDecision } from '@/lib/coach/typesafe'
import { serverDiagnostic } from '@/lib/diagnostics/server'
import { diagnosticCode } from '@/lib/diagnostics/schema'
import { failurePolicy } from '@/lib/coach/retry'

export const maxDuration = 40
export async function POST(req: Request) {
  const requestStarted = Date.now()
  const userId = await currentUserId()
  if (!userId) { serverDiagnostic(req, 'app', 'error', { httpStatus: 401, code: 'unauthorized' }); return Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (req.headers.get('origin') !== new URL(req.url).origin) { serverDiagnostic(req, 'app', 'error', { httpStatus: 403, code: 'unauthorized' }); return Response.json({ error: 'Same-origin request required' }, { status: 403 }) }
  if (!rateLimit(`repo-coach:${userId}`, 18, 60_000)) { serverDiagnostic(req, 'app', 'error', { httpStatus: 429, code: 'rate_limited' }); return Response.json({ error: 'Model request budget reached. Pause before retrying.' }, { status: 429, headers: { 'Retry-After': '10' } }) }
  let lane: Lane, context: ContextPacket, lessons: LessonId[], instructions: string
  try {
    const body = object(await readRepoJson(req, 100_000), ['lane', 'context', 'lessons', 'instructions'])
    if (!['talk', 'guide', 'review'].includes(String(body.lane))) throw new Error('Invalid lane')
    instructions = text(body.instructions ?? '', 1500); lane = body.lane as Lane; context = parseContext(body.context); lessons = lessonIds(body.lessons ?? [])
  } catch (error) {
    serverDiagnostic(req, 'app', 'error', { code: 'invalid_shape', httpStatus: error instanceof RepoRequestError ? error.status : 400 })
    return Response.json({ error: 'Invalid or oversized repository context' }, { status: error instanceof RepoRequestError ? error.status : 400 })
  }
  serverDiagnostic(req, lane, 'start', { retryAttempt: Number(req.headers.get('x-lt-attempt') || 1) })
  const decision = await judgeLiveContext(context, lane, req.signal)
  const routed = routeDecision(decision, lane)
  if (routed.suppress) {
    serverDiagnostic(req, lane, 'paused', { model: decision.model, durationMs: Date.now() - requestStarted })
    return new Response(`${JSON.stringify({ type: 'started', lane, evidenceVersion: context.evidenceVersion, decision })}\n${JSON.stringify({ type: 'done', model: decision.model, guidance: null })}\n`, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } })
  }
  lane = routed.lane
  let model: string
  try {
    model = liveCoachModel(lane)
    if (!validRepoModel(model)) throw new Error('Invalid model')
    assertRepoModelConfigured(model)
  } catch {
    serverDiagnostic(req, lane, 'error', { httpStatus: 503, code: 'provider_unavailable', durationMs: Date.now() - requestStarted })
    return Response.json({ error: 'Configure an available model and provider key for this assistance role.' }, { status: 503, headers: { 'x-lt-retryable': 'false' } })
  }
  const cancellation = new AbortController(), deadline = AbortSignal.timeout(lane === 'talk' ? 8500 : 28_000)
  const signal = AbortSignal.any([req.signal, cancellation.signal, deadline])
  const encoder = new TextEncoder(), started = performance.now()
  let closed = false, usage: ModelUsage | undefined, visibleOutput = false
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (value: Record<string, unknown>) => { if (!closed && !signal.aborted) { if (value.type === 'delta' || value.type === 'done') visibleOutput = true; controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)) } }
      try {
        emit({ type: 'started', lane, evidenceVersion: context.evidenceVersion, decision })
        const compiled = compileInterviewPrompt(context, lane, instructions)
        const request = { model, system: compiled.system + '\\n' + coachPrompt(lane) + lessonPrompt(lessons), evidence: compiled.evidence, signal, maxTokens: lane === 'talk' ? 384 : lane === 'review' ? 2200 : 3400 }
        if (lane === 'talk') {
          let returned = model, visible = '', firstTextMs: number | null = null
          for await (const part of streamRepoModel({ ...request, onUsage: value => { usage = value } })) {
            returned = part.model; visible += part.text
            if (visible.length > 12_000) throw new Error('Talk output budget exceeded')
            if (firstTextMs === null && visible.trim()) { firstTextMs = Math.round(performance.now() - started); serverDiagnostic(req, lane, 'first_token', { model: returned, firstTokenMs: Date.now() - requestStarted }) }
            emit({ type: 'delta', text: part.text, model: returned })
          }
          if (!visible.trim()) throw new Error('No spoken guidance returned')
          emit({ type: 'done', model: returned, guidance: null, firstTextMs, elapsedMs: Math.round(performance.now() - started) })
        } else {
          const result = await callRepoModel(request)
          usage = result.usage
          const guidance = parseGuidance(JSON.parse(result.text.trim()), context)
          emit({ type: 'done', model: result.model, guidance, elapsedMs: Math.round(performance.now() - started) })
        }
        serverDiagnostic(req, lane, signal.aborted ? 'cancelled' : 'success', { model, durationMs: Date.now() - requestStarted })
        recordUsage('repo-coach', userId, { lane, model, inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens, elapsedMs: Math.round(performance.now() - started), decisionSource: decision.source, decisionModel: decision.model, decisionMs: decision.elapsedMs, decisionTask: decision.task })
      } catch (error) {
        const policy = failurePolicy(error), status = policy.status
        serverDiagnostic(req, lane, req.signal.aborted || cancellation.signal.aborted ? 'cancelled' : 'error', { model, durationMs: Date.now() - requestStarted, httpStatus: status, code: deadline.aborted ? 'timeout' : diagnosticCode(error, status) })
        if (!closed && !req.signal.aborted) controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', error: 'Assistance stopped, timed out or returned unsupported evidence. Retry explicitly if needed.',
          retryable: !visibleOutput && !signal.aborted && policy.retryable, status, retryAfterMs: policy.retryAfterMs })}\n`))
      } finally { if (!closed) { closed = true; controller.close() } }
    },
    cancel() { closed = true; cancellation.abort() },
  })
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
}
